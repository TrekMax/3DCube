# 方序 · Cube Guide

Vue 3 + TypeScript 的三阶魔方复原 Web 程序：摄像头逐面采集 → 颜色校正 → 合法性检查 → 求解 → Three.js 分层动画指导。

## 启动

需要 Node.js 22.12+ 或 24。

```bash
npm install
npm run dev
```

访问 **http://localhost:5173**。点击右上方「体验演示魔方」，再点击「生成复原步骤」，无需摄像头即可体验完整求解和动画。

```bash
npm run build     # TypeScript 检查和生产构建，输出 dist/
npm run preview   # 预览生产构建
npm test          # 魔方合法性、求解、3D 坐标和 YOLO 后处理测试
npx playwright install chromium
npm run test:ui   # 浏览器端到端测试
```

摄像头只能在 **localhost 或 HTTPS** 下使用。手机访问局域网 HTTP 地址可以看到页面，但需通过 HTTPS 才能开启摄像头。部署时将 `dist/` 放在支持 HTTPS 的静态服务器，确保 `.wasm` 与 `.mjs` 资源正常提供。所有识别、求解和动画均在浏览器本地运行，无后端服务，无图像上传；运行时不依赖字体或推理 CDN。

## 已实现

- 摄像头开启、停止、前后镜头切换，以及权限/设备错误提示。
- 九宫格区域采色；连续多次结果一致后允许采集。
- 加载 Ultralytics ONNX 模型，通过 ONNX Runtime Web / WASM 本地检测色块。
- 模型实际输入/输出检查、RGB NCHW 预处理、置信度过滤、NMS 去重、九宫格映射、检测框显示。
- 按六个中心颜色引导采集，明确每一面的朝上方向，摄像头画面不镜像。
- 手动填色、擦除、旋转录入图；中心颜色固定；自动保存当前浏览器的录入草稿。
- 检查每色 9 块、角/棱块组合、角块扭转、棱块翻转和排列奇偶性。
- 在 Web Worker 中运行 cubejs / Kociemba 两阶段求解，返回后再次验证解法确实能复原。
- 26 个可见小块、54 个色贴的 Three.js 魔方，真实分层旋转与方向箭头。
- 单步前进/后退、自动播放/暂停、速度选择、跳转步骤、旋转视角和缩放。
- 暂停播放后扫描指定面，核对实物该面与当前动画状态是否一致。
- 导出魔方状态和解法 JSON；桌面与手机布局；内置中文使用指南。

## 配色与扫描方向

当前使用常见标准配色，面序为 **URFDLB**。每面按正对该面时，从左上到右下排列 9 格。

| 面     | 中心色 | 扫描时朝上的相邻中心色 |
| ------ | ------ | ---------------------- |
| U 顶面 | 白     | 蓝                     |
| R 右面 | 红     | 白                     |
| F 前面 | 绿     | 白                     |
| D 底面 | 黄     | 绿                     |
| L 左面 | 橙     | 白                     |
| B 后面 | 蓝     | 白                     |

扫描期间只整体转动魔方，不转动单层。让一整面正对取景框、9 个色块分别落入网格。反光、阴影和红橙色差可能影响采色，请人工核对。不同中心配色的魔方需修改 `src/lib/cube.ts` 的映射和扫描提示。

求解后，把实物摆成 **白色在上、绿色在前、红色在右**。旋转方向按正对正在转动的那个面判断：`R` 顺时针 90°、`R'` 逆时针 90°、`R2` 旋转 180°。后退按钮会播放逆动作；若实物跟随，则也需执行逆动作。点击步骤或自动播放仅改变数字魔方，不代表实物已执行对应动作。

## Ultralytics YOLO

使用用户指定的 [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics)。默认训练架构选择 YOLO11n；前端也支持兼容的 YOLOv8 检测输出。

**仓库没有附带已训练的真实魔方权重或标注数据。** Ultralytics 的通用 COCO 权重无法直接识别六种魔方色块。未加载专用模型时，程序明确显示「颜色采样模式」，可完成采集、校正与复原。训练脚本需要你提供标注数据；并未以测试用模型替代真实 YOLO 模型。

### 1. 数据集

按色块画检测框，使用以下固定类别顺序：

```text
0 white   白色
1 red     红色
2 green   绿色
3 yellow  黄色
4 orange  橙色
5 blue    蓝色
```

```text
cube-stickers/
  images/train/*.jpg
  images/val/*.jpg
  labels/train/*.txt
  labels/val/*.txt
```

标签采用 YOLO detection 格式：每行 `class_id x_center y_center width height`，坐标归一化到 0–1。为匹配浏览器推理，应以单面接近正视的裁剪图为主，包含不同光线、距离、贴纸磨损和背景；验证集按拍摄批次或魔方实体分开，避免同一连拍序列分到训练与验证两侧。

在 `models/cube-stickers.yaml` 中将 `path` 改为数据集的绝对路径。训练时禁用 hue 色相增强，因为颜色决定类别。

### 2. 训练并自动导出

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

# 有 NVIDIA GPU 时将 --device cpu 改为 --device 0
python scripts/train_yolo.py \
  --data models/cube-stickers.yaml \
  --model yolo11n.pt \
  --epochs 100 \
  --imgsz 320 \
  --device cpu
```

首次训练会下载基础权重。训练完成后导出到 `models/cube-stickers.onnx`，并用 ONNX Runtime 实际执行一次以校验输出结构。

### 3. 已有训练权重

```bash
python scripts/export_yolo.py /path/to/best.pt \
  --output models/cube-stickers.onnx \
  --imgsz 320
```

导出参数：`format=onnx, batch=1, dynamic=False, half=False, nms=False, opset=17`。程序只接受检测模型；脚本检查类别名称与顺序，避免把其他类别误当成魔方颜色。

### 4. 前端加载

点击摄像头卡片底部「加载 YOLO」，选择 `.onnx` 文件。浏览器读取文件，模型不上传。

- 输入：float32 `[1,3,S,S]`，静态正方形 RGB，取值 0–1。
- 支持输出：`[1,10,N]`、`[1,N,10]`，或已处理的 `[1,N,6]`。
- 原始输出为 `cx,cy,w,h` + 六类概率；六列输出为 `x1,y1,x2,y2,score,class_id`。
- 坐标必须是输入图像像素单位；类别 ID 必须符合上表。
- 仅支持色块检测，不支持 segmentation、pose、OBB 或 YOLOv5 的 objectness 输出。
- 因前端按固定九宫格归位，请保持魔方面接近正视；尚未实现任意透视角度的自动面分割或连续转动追踪。

推理异常会明确提示；专用模型加载成功后不会把采色结果伪装成 YOLO 输出。当前实现使用单线程 WASM，实际帧率取决于模型和设备。仅加载模型时才下载本地部署的 ONNX Runtime 资源。

训练与导出依据：[Ultralytics 导出文档](https://docs.ultralytics.com/modes/export/)、[检测数据集格式](https://docs.ultralytics.com/datasets/detect/)。推理依据：[ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)。

## 结构

```text
src/App.vue                       工作台、录入、校正、步骤播放
src/components/CameraScanner.vue   摄像头与扫描循环
src/components/CubeScene.vue       Three.js 魔方、分层动画、视角控制
src/components/FaceGrid.vue        色块网格
src/lib/cube.ts                    配色、合法性校验、魔方坐标
src/lib/vision.ts                  颜色采样、YOLO 输出解析与九宫格映射
src/lib/yolo.ts                    ONNX 会话和图像预处理
src/workers/solver.worker.ts       后台求解与结果校验
scripts/train_yolo.py              Ultralytics 训练和导出
scripts/export_yolo.py             已训练权重导出与结构检查
tests/                            单元与浏览器测试
```

`tests/fixtures/constant-white-test.onnx` 是仅供自动化测试的恒定输出小模型，用于验证浏览器 ONNX 加载/推理链路，**不具有识别能力**，不可用于实际识别。

求解库来自 [cubejs](https://github.com/ldez/cubejs)（MIT）；其旧版、未使用的 npm 工具依赖通过 package overrides 更新。Ultralytics 的许可说明见[原仓库](https://github.com/ultralytics/ultralytics)。
