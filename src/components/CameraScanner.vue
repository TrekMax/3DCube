<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  Camera,
  ScanLine,
  VideoOff,
  Upload,
  SwitchCamera,
  Check,
  LoaderCircle,
  Cpu,
  Focus,
  X,
} from '@lucide/vue';
import { TOP, type Face, type Sticker } from '../lib/cube';
import { sampleGrid, createColorClassifier, type Detection } from '../lib/vision';
import { usePalette } from '../lib/usePalette';
const { profile, colors: COLORS, names: NAMES } = usePalette();
const classify = computed(() => createColorClassifier(profile.value.colors));
import {
  chooseCube,
  intersectionOverUnion,
  projectToViewport,
  regionProblem,
  type CubeDetection,
  type Rect,
} from '../lib/localization';
import type { YoloDetector } from '../lib/yolo';
const props = defineProps<{ face: Face; disabled: boolean }>();
const emit = defineEmits<{ capture: [colors: Sticker[]]; model: [name: string] }>();
const video = ref<HTMLVideoElement>(),
  guide = ref<HTMLDivElement>(),
  viewport = ref<HTMLDivElement>(),
  fileInput = ref<HTMLInputElement>(),
  positionInput = ref<HTMLInputElement>();
const active = ref(false),
  starting = ref(false),
  loading = ref(false),
  processing = ref(false),
  message = ref(''),
  modelName = ref(''),
  locatorName = ref('');
const modelScope = ref<'face' | 'frame'>('face');
const colors = ref<Sticker[]>(Array(9).fill('?')),
  boxes = ref<Detection[]>([]),
  stable = ref(0),
  latency = ref(0);
const tracked = ref<CubeDetection | null>(null),
  projected = ref<Rect | null>(null),
  trackingMessage = ref('正在全画面寻找魔方…');
const fault = ref<'cube' | 'stickers' | ''>('');
const facing = ref<'environment' | 'user'>('environment');
let stream: MediaStream | null = null,
  timer: ReturnType<typeof setTimeout>,
  detector: YoloDetector | null = null,
  locator: YoloDetector | null = null;
let disposed = false,
  generation = 0,
  previous = '',
  inference: Promise<void> | null = null;
let colorVersion = 0;
watch(profile, () => {
  colorVersion++;
  clearColors();
});
const crop = document.createElement('canvas'),
  fullFrame = document.createElement('canvas');
crop.width = crop.height = 320;
const autoPosition = computed(() => !!locatorName.value);
const overlayStyle = computed(() =>
  projected.value
    ? {
        left: `${projected.value.x}px`,
        top: `${projected.value.y}px`,
        width: `${projected.value.width}px`,
        height: `${projected.value.height}px`,
      }
    : {},
);
const canCapture = computed(
  () =>
    active.value &&
    !loading.value &&
    !processing.value &&
    !fault.value &&
    (!autoPosition.value || (!!tracked.value && !trackingMessage.value)) &&
    stable.value >= 3 &&
    !colors.value.includes('?') &&
    colors.value[4] === props.face &&
    !props.disabled,
);
function clearColors() {
  colors.value = Array(9).fill('?');
  boxes.value = [];
  stable.value = 0;
  previous = '';
}
function clearPosition() {
  tracked.value = null;
  projected.value = null;
  clearColors();
}
watch(
  () => props.face,
  () => {
    stable.value = 0;
    previous = '';
  },
);
async function start() {
  if (starting.value || disposed) return;
  const current = ++generation;
  starting.value = true;
  message.value = '';
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('摄像头需要 HTTPS 或 localhost 安全地址。');
    const nextStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing.value },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    if (disposed || current !== generation) {
      nextStream.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = nextStream;
    active.value = true;
    await nextTick();
    video.value!.srcObject = stream;
    await video.value!.play();
    stream.getVideoTracks()[0]!.onended = () => {
      stop();
      message.value = '摄像头连接已结束，请重新开启。';
    };
    schedule();
  } catch (error) {
    stop();
    const e = error as Error;
    message.value =
      e.name === 'NotAllowedError'
        ? '摄像头权限未开启。请在浏览器地址栏允许访问，或使用手动录入。'
        : e.name === 'NotFoundError'
          ? '没有找到摄像头。你仍可以手动录入，或体验演示魔方。'
          : e.name === 'NotReadableError'
            ? '摄像头被其他程序占用，请关闭后重试。'
            : `摄像头启动失败：${e.message}`;
  } finally {
    starting.value = false;
  }
}
function stop() {
  generation++;
  clearTimeout(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video.value) video.value.srcObject = null;
  active.value = false;
  clearPosition();
  trackingMessage.value = '正在全画面寻找魔方…';
}
async function switchCamera() {
  stop();
  facing.value = facing.value === 'user' ? 'environment' : 'user';
  await start();
}
function schedule() {
  clearTimeout(timer);
  if (disposed || !active.value || inference) return;
  timer = setTimeout(
    () => {
      inference = scan().finally(() => {
        inference = null;
        schedule();
      });
    },
    detector || locator ? 200 : 120,
  );
}
async function scan() {
  const v = video.value,
    view = viewport.value;
  if (!v || !view || v.readyState < 2 || loading.value || fault.value || !active.value) return;
  const current = generation,
    startTime = performance.now(),
    frame = view.getBoundingClientRect();
  const currentColorVersion = colorVersion,
    palette = profile.value,
    classifier = classify.value;
  let stage: 'cube' | 'stickers' = locator ? 'cube' : 'stickers';
  let positionStable = true;
  let region: Rect;
  const fullFrameColors = detector?.inputScope === 'frame';
  processing.value = true;
  try {
    if (locator || fullFrameColors) {
      fullFrame.width = v.videoWidth;
      fullFrame.height = v.videoHeight;
      fullFrame.getContext('2d')!.drawImage(v, 0, 0);
    }
    if (locator) {
      const candidates = await locator.locate(fullFrame);
      if (disposed || current !== generation) return;
      const previousBox = tracked.value,
        found = chooseCube(candidates, previousBox);
      if (!found) {
        clearPosition();
        trackingMessage.value = '未检测到魔方，请放入画面';
        return;
      }
      tracked.value = found;
      projected.value = projectToViewport(
        found,
        v.videoWidth,
        v.videoHeight,
        frame.width,
        frame.height,
      );
      trackingMessage.value = regionProblem(found, v.videoWidth, v.videoHeight);
      if (trackingMessage.value) {
        clearColors();
        return;
      }
      positionStable = !!previousBox && intersectionOverUnion(found, previousBox) >= 0.8;
      region = found;
      // Read colors from the exact frame that produced this detection, not a later video frame.
      crop
        .getContext('2d', { willReadFrequently: true })!
        .drawImage(
          fullFrame,
          found.x * v.videoWidth,
          found.y * v.videoHeight,
          found.width * v.videoWidth,
          found.height * v.videoHeight,
          0,
          0,
          320,
          320,
        );
    } else {
      const grid = guide.value;
      if (!grid) return;
      const box = grid.getBoundingClientRect(),
        scale = Math.max(frame.width / v.videoWidth, frame.height / v.videoHeight);
      const sx = (box.left - frame.left + (v.videoWidth * scale - frame.width) / 2) / scale;
      const sy = (box.top - frame.top + (v.videoHeight * scale - frame.height) / 2) / scale;
      region = {
        x: sx / v.videoWidth,
        y: sy / v.videoHeight,
        width: box.width / scale / v.videoWidth,
        height: box.height / scale / v.videoHeight,
      };
      crop
        .getContext('2d', { willReadFrequently: true })!
        .drawImage(
          fullFrameColors ? fullFrame : v,
          sx,
          sy,
          box.width / scale,
          box.height / scale,
          0,
          0,
          320,
          320,
        );
    }
    stage = 'stickers';
    const result = detector
      ? await detector.detect(
          fullFrameColors ? fullFrame : crop,
          palette.yoloFaces,
          fullFrameColors ? region : undefined,
        )
      : { colors: sampleGrid(crop, classifier), detections: [] };
    if (disposed || current !== generation || currentColorVersion !== colorVersion) return;
    colors.value = result.colors;
    boxes.value = result.detections;
    const key = colors.value.join('');
    stable.value = previous === key && positionStable ? stable.value + 1 : 0;
    previous = key;
  } catch (error) {
    if (current !== generation || disposed) return;
    fault.value = stage;
    message.value = `YOLO ${stage === 'cube' ? '定位' : '色块识别'}失败：${(error as Error).message}。请更换或停用对应模型。`;
    clearPosition();
    trackingMessage.value = '定位已暂停，请检查模型';
  } finally {
    processing.value = false;
    latency.value = Math.round(performance.now() - startTime);
  }
}
async function loadModel(event: Event, purpose: 'stickers' | 'cube') {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file || loading.value) return;
  loading.value = true;
  message.value = '';
  clearColors();
  try {
    await inference;
    const { YoloDetector } = await import('../lib/yolo');
    const next = await YoloDetector.load(file, purpose);
    if (disposed) {
      await next.release();
      return;
    }
    if (purpose === 'cube') {
      await locator?.release();
      locator = next;
      locatorName.value = file.name;
    } else {
      await detector?.release();
      detector = next;
      modelName.value = file.name;
      modelScope.value = next.inputScope;
      emit('model', file.name);
    }
    if (fault.value === purpose) fault.value = '';
    clearPosition();
    trackingMessage.value = '正在全画面寻找魔方…';
  } catch (error) {
    message.value = `模型加载失败：${(error as Error).message}`;
  } finally {
    loading.value = false;
    input.value = '';
  }
}
async function unloadModel(purpose: 'cube' | 'stickers') {
  if (loading.value) return;
  loading.value = true;
  try {
    await inference;
    if (purpose === 'cube') {
      await locator?.release();
      locator = null;
      locatorName.value = '';
    } else {
      await detector?.release();
      detector = null;
      modelName.value = '';
      modelScope.value = 'face';
      emit('model', '');
    }
    if (fault.value === purpose) fault.value = '';
    message.value = '';
    clearPosition();
  } finally {
    loading.value = false;
  }
}
function capture() {
  if (canCapture.value) {
    emit('capture', [...colors.value]);
    stable.value = 0;
    previous = '';
  }
}
onBeforeUnmount(() => {
  disposed = true;
  stop();
  void (inference ?? Promise.resolve()).finally(() =>
    Promise.all([detector?.release(), locator?.release()]),
  );
});
defineExpose({ openModelPicker: () => positionInput.value?.click(), stop });
</script>
<template>
  <div class="camera-section">
    <div class="panel-heading">
      <div class="heading-title">
        <span class="icon-tile"><Camera :size="18" /></span>
        <h2>扫描你的魔方</h2>
      </div>
      <span class="status-pill" :class="{ live: active }"
        ><i />{{ active ? '摄像头已连接' : '等待连接' }}</span
      >
    </div>
    <div
      ref="viewport"
      class="camera-viewport"
      :class="{ active, 'auto-position': active && autoPosition }"
    >
      <video ref="video" autoplay playsinline muted v-show="active" />
      <div class="camera-topline">
        <span
          ><span class="live-dot" :class="{ on: active }" />{{
            active ? 'LIVE CAMERA' : 'CAMERA PREVIEW'
          }}</span
        ><button v-if="active" class="camera-icon" aria-label="关闭摄像头" @click="stop">
          <VideoOff :size="17" /></button
        ><Focus v-else :size="17" />
      </div>
      <div v-if="!active || !autoPosition" ref="guide" class="scan-guide">
        <span class="corner tl" /><span class="corner tr" /><span class="corner bl" /><span
          class="corner br"
        />
        <div v-if="active" class="guide-grid"><span v-for="i in 9" :key="i" /></div>
        <div
          v-if="active"
          class="detection-box"
          v-for="(box, i) in boxes"
          :key="i"
          :style="{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
            borderColor: COLORS[box.color],
          }"
        />
        <div v-if="!active" class="camera-empty">
          <div class="scan-symbol"><ScanLine :size="36" :stroke-width="1.1" /></div>
          <h3>从一个面开始</h3>
          <p>{{ autoPosition ? '将魔方放入画面，自动寻找位置' : '加载定位模型可自动框选魔方' }}</p>
          <button class="btn primary" :disabled="starting" @click="start">
            <LoaderCircle v-if="starting" class="spin" :size="16" /><Camera v-else :size="16" />{{
              starting ? '正在连接…' : '开启摄像头'
            }}
          </button>
        </div>
      </div>
      <div
        v-if="active && autoPosition && tracked"
        class="tracked-cube"
        :class="{ ready: !trackingMessage }"
        :style="overlayStyle"
      >
        <span class="tracked-label">魔方 {{ Math.round(tracked.score * 100) }}%</span>
        <div v-if="!trackingMessage" class="guide-grid"><span v-for="i in 9" :key="i" /></div>
        <div
          v-for="(box, i) in boxes"
          :key="i"
          class="detection-box"
          :style="{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
            borderColor: COLORS[box.color],
          }"
        />
      </div>
      <div
        v-if="active && autoPosition"
        class="tracking-status"
        :class="{ found: tracked && !trackingMessage }"
      >
        <Focus :size="14" />{{ trackingMessage || '已定位 · 保持一面正对镜头' }}
      </div>
      <div class="camera-bottomline">
        <span><span class="privacy-dot" />图像仅在本机处理</span
        ><button
          v-if="active"
          class="camera-icon"
          aria-label="切换前后摄像头"
          @click="switchCamera"
        >
          <SwitchCamera :size="18" /></button
        ><span v-else>3 × 3</span>
      </div>
    </div>
    <div class="scan-instruction">
      <span class="color-dot" :style="{ background: COLORS[face] }" />
      <div>
        <strong>{{ NAMES[face] }}色中心朝向镜头</strong>
        <p>{{ NAMES[TOP[face]] }}色中心朝上 · 保持魔方面水平</p>
      </div>
      <span class="face-tag">{{ face }}</span>
    </div>
    <div v-if="active" class="live-result">
      <div class="sample-colors">
        <span v-for="(c, i) in colors" :key="i" :style="{ background: COLORS[c] }" />
      </div>
      <span>{{
        colors.includes('?')
          ? autoPosition
            ? '等待清晰的九个色块'
            : '请对齐九个色块'
          : colors[4] !== face
            ? '请转到指定中心色'
            : stable < 3
              ? '保持稳定…'
              : '颜色已稳定'
      }}</span
      ><button class="btn primary compact" :disabled="!canCapture" @click="capture">
        <Check :size="15" />采集此面
      </button>
    </div>
    <p v-if="message" class="inline-error" role="alert">{{ message }}</p>
    <div class="model-line locator-line">
      <span :title="locatorName || '加载单类 cube 模型，自动跟随魔方位置'"
        ><Focus :size="14" />{{
          locatorName ? '自动定位 · ' + locatorName : '自动定位 · 未加载模型'
        }}</span
      >
      <div class="model-actions">
        <button class="text-btn" :disabled="loading" @click="positionInput?.click()">
          <Upload :size="13" />{{ locatorName ? '更换定位模型' : '加载定位模型' }}</button
        ><button
          v-if="locatorName"
          class="icon-button model-remove"
          aria-label="停用定位模型"
          :disabled="loading"
          @click="unloadModel('cube')"
        >
          <X :size="13" />
        </button>
      </div>
    </div>
    <div class="model-line">
      <span
        ><Cpu :size="14" />{{
          modelName
            ? 'YOLO · ' + modelName + (modelScope === 'frame' ? ' · 全画面识别' : '')
            : autoPosition
              ? '定位区域 · 颜色采样'
              : '固定框 · 颜色采样'
        }}<small v-if="active">{{ latency }} ms</small></span
      >
      <div class="model-actions">
        <button class="text-btn" :disabled="loading" @click="fileInput?.click()">
          <LoaderCircle v-if="loading" :size="13" class="spin" /><Upload v-else :size="13" />{{
            loading ? '加载中…' : modelName ? '更换色块模型' : '加载色块模型'
          }}</button
        ><button
          v-if="modelName"
          class="icon-button model-remove"
          aria-label="停用色块模型"
          :disabled="loading"
          @click="unloadModel('stickers')"
        >
          <X :size="13" />
        </button>
      </div>
    </div>
    <input
      ref="positionInput"
      type="file"
      accept=".onnx"
      aria-label="魔方定位 ONNX 模型"
      hidden
      @change="loadModel($event, 'cube')"
    />
    <input
      ref="fileInput"
      type="file"
      accept=".onnx"
      aria-label="色块识别 ONNX 模型"
      hidden
      @change="loadModel($event, 'stickers')"
    />
  </div>
</template>
