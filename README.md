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
python3 -m unittest discover -s tests -p 'test_*.py' # 模型类别校验，无需 ML 依赖
```

摄像头只能在 **localhost 或 HTTPS** 下使用。手机访问局域网 HTTP 地址可以看到页面，但需通过 HTTPS 才能开启摄像头。部署时将 `dist/` 放在支持 HTTPS 的静态服务器，确保 `.wasm` 与 `.mjs` 资源正常提供。所有识别、求解和动画均在浏览器本地运行，无后端服务，无图像上传；运行时不依赖字体或推理 CDN。

## 已实现

- 摄像头开启、停止、前后镜头切换，以及权限/设备错误提示。
- YOLO 全画面自动定位魔方，检测框随位置和距离变化；定位区域自动裁剪为九宫格采色。
- 目标丢失立即清空识别结果；过小、截断或明显非正视时暂停采集；位置和颜色连续稳定后允许采集。
- 定位模型、色块模型分别加载和停用；不加载定位模型时仍可使用固定九宫格。
- 加载 Ultralytics ONNX 模型，通过 ONNX Runtime Web / WASM 本地检测色块。
- 模型实际输入/输出检查、RGB NCHW 预处理、等比例缩放与补边（LetterBox）、坐标还原、置信度过滤、NMS 去重和检测框显示。
- 按六个中心颜色引导采集，明确每一面的朝上方向，摄像头画面不镜像。
- 3D 选面采集：点击立体魔方选面，六个快捷按钮可正对顶面、底面或背面，摄像头与校色入口同步切换。
- 手动填色、擦除、旋转录入图；中心颜色固定；自动保存当前浏览器的录入草稿。
- 未录入色块以 `?` 显示；逐面列出缺失格数，未填完整时保存为草稿，可只补齐空格并保留已录入颜色。
- 自定义六面颜色名称、颜色选择器与 HEX 色值，同步摄像头采色、手动校色、3D 视图和方向提示；可配置 YOLO 类别 ID 对应面。
- 检查每色 9 块、角/棱块组合、角块扭转、棱块翻转和排列奇偶性。
- 在 Web Worker 中运行 cubejs / Kociemba 两阶段求解，返回后再次验证解法确实能复原。
- 26 个可见小块、54 个色贴的 Three.js 魔方，真实分层旋转与方向箭头。
- 单步前进/后退、自动播放/暂停、速度选择、跳转步骤、旋转视角和缩放。
- 暂停播放后扫描指定面，核对实物该面与当前动画状态是否一致。
- 导出含配色配置的魔方状态和解法 JSON；桌面与手机布局；内置中文使用指南。

## 3D 六面采集

1. 在「3D 采集与校色」中拖动魔方查看六面，点击可见色块选择所在面；或点击下方 **U/R/F/D/L/B** 按钮，直接正对指定面。手机支持触摸选面与拖动，按钮也支持键盘操作。
2. 根据当前面的中心色、朝上色提示摆放实物。「正对当前面」会将 3D 视角转到与九宫格相同的方向，包括顶面、底面和背面。
3. 在摄像头中对齐该面，稳定后点击「采集此面」。结果同步到 3D 魔方，程序自动选中下一个未完成的面；只拖动视角不会改动色块数据。
4. 点击「补齐此面」或下方的小九宫格进入校色。**先选择颜色，再点击对应格子**；也可用当前颜色只补齐空格，已录入的格子会保留。颜色名称和色值随自定义配色变化。
5. 未填完九格时，按钮显示「保存草稿」，保存后明确提示缺失格数；填完整后显示「保存此面」，计入六面进度。页面刷新后保留草稿，六面完整后仍会检查颜色数量和魔方物理合法性。

3D 在这里用于选面与朝向指导；摄像头仍逐面采集，需要让一个面正对镜头。目前不自动估计实物的三维姿态，也不从一次拍摄推断背面或连续转动中的全部颜色。

### 颜色齐全但提示棱块方向或位置奇偶性不合法

六色各 9 格并不保证状态可复原。程序保留角块、棱块方向及位置约束检查，与 [Kociemba 的合法性检查](https://github.com/hkociemba/RubiksCube-TwophaseSolver/blob/master/cubie.py) 一致。

报错下方会显示「具体核对位置」：棱块朝向总和异常时，列出当前数据中的反向棱块及对应的两个色块，点击即可进入相应面的校色窗口并高亮目标格。位置按每面从左上到右下的 1–9 编号，查看时保持页面提示的相邻中心色朝上。

这些位置是核对线索，不能单凭它们断定实物被拆装或唯一确定错误颜色。位置奇偶性是整个魔方的约束，无法据此指定某格必然有错。请按实物核对颜色与每面的朝向，确保六面采集期间没有转动单层；程序不会自动改色来凑出可求解状态。

## 配色与扫描方向

在 **「六面采集 → 自定义配色」** 中设置六个面的颜色名称与 HEX 色值，也可使用颜色选择器。按照实物中心色的位置填写；相对面固定为 **U/D、R/L、F/B**。颜色配置与录入草稿一起保存在当前浏览器，重新打开会恢复，也可恢复默认配色。

修改色值或 YOLO 类别映射后，需要点击「应用并重新扫描」，清空原录入与解法后按新配色重新采集；只修改名称会保留录入。取消设置不会改变当前配色。重复名称、无法区分的颜色和重复类别映射会阻止保存。

默认使用下表配色，面序为 **URFDLB**。每面按正对该面时，从左上到右下排列 9 格。自定义后，页面中的中心色、朝上色和复原提示会随配置更新。

| 面     | 中心色 | 扫描时朝上的相邻中心色 |
| ------ | ------ | ---------------------- |
| U 顶面 | 白     | 蓝                     |
| R 右面 | 红     | 白                     |
| F 前面 | 绿     | 白                     |
| D 底面 | 黄     | 绿                     |
| L 左面 | 橙     | 白                     |
| B 后面 | 蓝     | 白                     |

扫描期间只整体转动魔方，不转动单层。自动定位时可将魔方放在画面任意位置，保持一面正对镜头，检测框应贴合整面边缘；不需要对齐固定取景框。未加载定位模型时，仍需将 9 个色块分别对齐固定网格。反光、阴影和红橙色差可能影响采色，请人工核对。

颜色采样在默认配色下使用 HSV 阈值；自定义配色使用 [Oklab 色彩空间](https://bottosson.github.io/posts/oklab/) 比较采样值与六种参考颜色，降低亮度差异的权重，并拒绝距离过远或无法区分的结果。色值应接近摄像头在实际光线下看到的颜色；此方式不包含自动白平衡校准，强反光或大幅曝光变化时仍需校色。

求解后，按页面提示把实物摆成 **U 面在上、F 面在前、R 面在右**（默认白上、绿前、红右）。旋转方向按正对正在转动的那个面判断：`R` 顺时针 90°、`R'` 逆时针 90°、`R2` 旋转 180°。后退按钮会播放逆动作；若实物跟随，则也需执行逆动作。点击步骤或自动播放仅改变数字魔方，不代表实物已执行对应动作。

## Ultralytics YOLO

使用用户指定的 [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics)。默认训练架构选择 YOLO11n；前端也支持兼容的 YOLOv8 检测输出。

**仓库没有附带已训练的真实魔方权重或标注数据。** Ultralytics 的通用 COCO 权重不能直接作为这里的单类魔方定位或六类色块模型。未加载专用模型时，程序明确显示固定框采样模式，可完成采集、校正与复原。训练脚本需要你提供标注数据；并未以测试用模型替代真实 YOLO 模型。

### 使用现有 rubik-yolo 模型

支持导入 [rubik-yolo](https://github.com/ThatLinuxGuyYouKnow/rubik-yolo) 的 **`best.pt`**。它是 YOLOv8n OBB 权重，包含 Blue、Green、Orange、Red、White、Yellow、cube face、side_face 共 8 类。目录中的 `yolov8n-obb.pt` 是 DOTA 基础权重，不能用于魔方识别。浏览器不直接加载 `.pt` 或原始 OBB 输出，需要先转换：

```bash
# Python 3.12；CPU 版可避免下载 CUDA 依赖
python3.12 -m venv .venv
source .venv/bin/activate
pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r scripts/requirements-rubik-yolo.txt
python scripts/import_rubik_yolo.py /home/listenai/Desktop/rubik-yolo/best.pt
```

脚本保留源目录不变，在 `models/` 中生成以下文件，并通过 ONNX Runtime 核对转换前后的数值：

| 文件                       | 页面操作     | 用途                                                         |
| -------------------------- | ------------ | ------------------------------------------------------------ |
| `rubik-yolo-locator.onnx`  | 加载定位模型 | 提取 cube face 类别，自动框选魔方面                          |
| `rubik-yolo-stickers.onnx` | 加载色块模型 | 六种标准色识别，已重排为默认白、红、绿、黄、橙、蓝（URFDLB） |
| `rubik-yolo.json`          | 无需加载     | 来源哈希、类别和导出结构记录                                 |

模型和中间权重仅保存在本地，Git 不跟踪这些二进制文件。更改默认配色时，应按模型实际颜色设置类别映射。**这个模型只有一个 Blue 类别，不能区分浅蓝、深蓝、透明蓝。** 对这类自定义配色，可先只加载定位模型，继续使用自定义颜色采样并人工核对；使用 YOLO 区分这些颜色需要补充训练数据。

色块模型使用**完整摄像头帧**推理，再将当前魔方面内的色块转换到九宫格坐标。定位和识别使用同一帧；未加载定位模型时，取固定网格范围内的识别结果。页面会显示「全画面识别」。普通六类模型仍使用魔方面裁剪图。

导出器将 OBB 旋转框转换为外接矩形，屏蔽 cube face / side_face 的色块输出，并在输入名 `cube_guide_full_frame` 中记录全画面约定。它不会校正透视或旋转面内九宫格，采集时仍须保持**单面正对镜头、指定中心色朝上**。

在本机用源目录的 5 张验证图片实测：4 张定位成功，其中 3 张得到完整九宫格；另 1 张未检测到面、1 张九宫格不完整。源项目说明验证集很小且与训练场景相似，不能据此推断其他魔方和光线下的准确率。可运行真实权重的浏览器验证（另一个终端先启动 `npm run dev`）：

```bash
node scripts/verify_rubik_yolo.mjs /home/listenai/Desktop/rubik-yolo/val/images
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

浏览器验证使用实际 WASM 推理、样例图片和页面采集按钮，报告与截图保存在 `test-results/rubik-yolo/`，不需要开启实体摄像头。若存在同级 `labels/`，还会对照原始标注并报告差异。本次完整九宫格的 27 格中，26 格与标注一致；`0d246fa0-20251229_172826.jpg` 第 9 格识别为绿色、标注为红色，图像目视为绿色，疑似原标注错误。脚本保留并报告该差异，不修改标签或识别结果；这些样例不足以给出可靠的总体准确率。

### 自动定位模型（单类 cube）

摄像头卡片底部新增 **「加载定位模型」**。加载后流程为：

```text
完整摄像头帧 → 等比例缩放/补边 → YOLO 魔方框 → 还原原始坐标
→ 跟随目标 → 从同一帧裁剪魔方区域 → 颜色采样/可选色块 YOLO → 稳定后采集
```

自动定位显示整个摄像头画面，保留比例并用留黑边的方式适配窗口；横竖屏与窗口大小变化均按实际视频尺寸转换检测坐标。画面里有多个目标时优先跟随上一帧重叠的目标，否则选择最高置信度目标。未检测到魔方时立即暂停采集，不沿用上一帧的颜色或坐标。

1. 以**完整摄像头图像**制作数据集，包含魔方出现在不同位置、不同大小、不同背景和光照的图片。
2. 标注一个类别：`0 cube`，用紧贴外轮廓的矩形框包住完整魔方，尽量不包含手和背景。使用 YOLO detection 标签格式。
3. 修改 `models/cube-locator.yaml` 的 `path`，指向你的数据集。目录与下方色块数据集结构相同。
4. 安装下方 Python 依赖后执行：

```bash
python scripts/train_yolo.py --task cube --imgsz 320 --epochs 100 --device cpu

# 或导出已经训练好的单类 cube 权重
python scripts/export_yolo.py /path/to/cube-best.pt --task cube --imgsz 320
```

输出为 `models/cube-locator.onnx`。在页面「加载定位模型」中选中此文件。**色块模型不是定位模型，两个加载入口有各自的类别约定。** 仅加载定位模型即可自动定位并使用颜色采样；也可同时加载色块模型。

定位只确定魔方的外接矩形，不会自动消除透视或区分同时可见的多个面。采集颜色时仍需保持**一个面正对镜头、按提示的相邻中心朝上**；明显过小、超出画面或长宽失衡的框会阻止采集。当前采用逐帧检测与相邻框重叠匹配，没有实现三维姿态估计或旋转动作跟踪。

### 1. 数据集

按色块画检测框，默认类别顺序如下：

```text
0 white   白色
1 red     红色
2 green   绿色
3 yellow  黄色
4 orange  橙色
5 blue    蓝色
```

支持任意六种颜色：修改数据集 YAML 的 `names`，保留连续的类别 ID **0–5** 和六个不同的名称。例如将 `0 white` 改为 `0 purple`、`3 yellow` 改为 `3 pink`，使用对应紫色、粉色色块数据训练。导出脚本会打印类别列表，在页面 **「自定义配色 → YOLO 类别映射」** 中把每个 ID 对应到实际中心色所属的面。

**修改配色或类别映射不会让已有模型学会新的颜色。** 新颜色可以直接使用颜色采样；使用 YOLO 色块检测则需要包含这些颜色的训练权重。魔方定位模型的 `cube` 类别不随配色设置改变，其实际效果仍取决于训练数据覆盖。

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

导出参数：`format=onnx, batch=1, dynamic=False, half=False, nms=False, opset=17`。程序只接受检测模型；脚本检查色块模型具有六个不同的类别名称和连续 ID，定位模型仍要求唯一类别 `cube`。脚本无法判断任意六类权重是否真的经过色块训练，请按数据集定义设置前端映射。

### 4. 前端加载

点击摄像头卡片底部「加载色块模型」，选择六类色块 `.onnx` 文件；定位模型请使用「加载定位模型」。浏览器读取文件，模型不上传。

- 输入：float32 `[1,3,S,S]`，静态正方形 RGB，取值 0–1。
- 色块模型输出：`[1,10,N]`、`[1,N,10]`，或已处理的 `[1,N,6]`。
- 定位模型输出：`[1,5,N]`、`[1,N,5]`，或已处理的 `[1,N,6]`；唯一类别 ID 为 0（cube）。
- 原始输出为 `cx,cy,w,h` + 各类别概率；六列输出为 `x1,y1,x2,y2,score,class_id`。
- 坐标必须是输入图像像素单位；色块类别 ID 必须符合「自定义配色」中的映射，默认映射为上表对应的 URFDLB。
- 支持上述魔方定位与色块检测；不直接支持 segmentation、pose、原始 OBB 或 YOLOv5 的 objectness 输出。rubik-yolo OBB 可通过上方专用脚本转换。
- 已自动定位的区域会映射到九宫格；请保持魔方面接近正视，尚未实现任意透视角度的自动面分割或连续转动追踪。

推理异常会明确提示；专用模型加载成功后不会把采色结果伪装成 YOLO 输出。当前实现使用单线程 WASM，实际帧率取决于模型和设备。仅加载模型时才下载本地部署的 ONNX Runtime 资源。

训练与导出依据：[Ultralytics 导出文档](https://docs.ultralytics.com/modes/export/)、[检测数据集格式](https://docs.ultralytics.com/datasets/detect/)。补边处理依据：[Ultralytics LetterBox](https://docs.ultralytics.com/reference/data/augment/#ultralytics.data.augment.LetterBox)。推理依据：[ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)。

## 结构

```text
src/App.vue                       工作台、录入、校正、步骤播放
src/components/CameraScanner.vue   摄像头与扫描循环
src/components/CubeScene.vue       Three.js 魔方、分层动画、视角控制
src/components/CubeCapture.vue     3D 采集选面、方向提示、单面进度与校色入口
src/components/CubeDiagnostics.vue 合法性报错的棱块位置核对入口
src/components/FaceGrid.vue        色块网格
src/components/ColorSettings.vue   六面配色与 YOLO 类别映射设置
src/lib/cube.ts                    默认配色、合法性校验、魔方坐标
src/lib/palette.ts                 配色校验、配置与草稿存储迁移
src/lib/usePalette.ts              全界面共享的响应式配色
src/lib/color.ts                   Oklab 颜色转换与自定义采色
src/lib/vision.ts                  颜色采样、YOLO 输出解析与九宫格映射
src/lib/localization.ts            补边坐标还原、目标选择、视口投影、位置检查
src/lib/yolo.ts                    ONNX 会话和图像预处理
src/workers/solver.worker.ts       后台求解与结果校验
scripts/train_yolo.py              Ultralytics 训练和导出
scripts/export_yolo.py             已训练权重导出与结构检查
scripts/import_rubik_yolo.py       rubik-yolo OBB 适配、类别重排和数值校验
scripts/verify_rubik_yolo.mjs       真实权重的浏览器推理与页面采集验证
tests/                            单元与浏览器测试
```

`tests/fixtures/constant-white-test.onnx` 是恒定色块输出测试模型；`input-driven-cube-test.onnx` 让测试视频的亮度控制输出坐标和置信度，以验证移动、丢失、重新出现和窗口缩放。它们都**不具有真实识别能力**，不可用作实际魔方模型。后者可用 `python3 tests/fixtures/generate_locator.py` 重新生成。

`input-driven-frame-stickers-test.onnx` 同样是测试图，用于验证全画面色块识别与定位坐标一致、目标丢失后清空结果；可用 `python3 tests/fixtures/generate_frame_stickers.py` 重新生成。真实识别能力使用上方 rubik-yolo 验证脚本单独检查。

求解库来自 [cubejs](https://github.com/ldez/cubejs)（MIT）；其旧版、未使用的 npm 工具依赖通过 package overrides 更新。Ultralytics 的许可说明见[原仓库](https://github.com/ultralytics/ultralytics)。
