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
} from '@lucide/vue';
import { COLORS, NAMES, TOP, type Face, type Sticker } from '../lib/cube';
import { sampleGrid, type Detection } from '../lib/vision';
import type { YoloDetector } from '../lib/yolo';
const props = defineProps<{ face: Face; disabled: boolean }>();
const emit = defineEmits<{ capture: [colors: Sticker[]]; model: [name: string] }>();
const video = ref<HTMLVideoElement>(),
  guide = ref<HTMLDivElement>(),
  viewport = ref<HTMLDivElement>(),
  fileInput = ref<HTMLInputElement>();
const active = ref(false),
  starting = ref(false),
  loading = ref(false),
  message = ref(''),
  modelName = ref('');
const colors = ref<Sticker[]>(Array(9).fill('?')),
  boxes = ref<Detection[]>([]),
  stable = ref(0),
  latency = ref(0);
const facing = ref<'environment' | 'user'>('environment');
let stream: MediaStream | null = null,
  timer: ReturnType<typeof setTimeout>,
  detector: YoloDetector | null = null;
let disposed = false,
  generation = 0,
  previous = '',
  inference: Promise<void> | null = null;
const crop = document.createElement('canvas');
crop.width = crop.height = 320;
const canCapture = computed(
  () =>
    active.value &&
    stable.value >= 3 &&
    !colors.value.includes('?') &&
    colors.value[4] === props.face &&
    !props.disabled,
);
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
  stable.value = 0;
  previous = '';
  colors.value = Array(9).fill('?');
  boxes.value = [];
}
async function switchCamera() {
  stop();
  facing.value = facing.value === 'user' ? 'environment' : 'user';
  await start();
}
function schedule() {
  clearTimeout(timer);
  if (!disposed && active.value)
    timer = setTimeout(
      () => {
        inference = scan().finally(() => {
          inference = null;
          schedule();
        });
      },
      detector ? 200 : 120,
    );
}
async function scan() {
  const v = video.value,
    view = viewport.value,
    grid = guide.value;
  if (!v || !view || !grid || v.readyState < 2 || loading.value || !active.value) return;
  const current = generation,
    startTime = performance.now();
  const frame = view.getBoundingClientRect(),
    box = grid.getBoundingClientRect();
  const scale = Math.max(frame.width / v.videoWidth, frame.height / v.videoHeight);
  const offsetX = (v.videoWidth * scale - frame.width) / 2,
    offsetY = (v.videoHeight * scale - frame.height) / 2;
  const sx = (box.left - frame.left + offsetX) / scale,
    sy = (box.top - frame.top + offsetY) / scale;
  crop
    .getContext('2d', { willReadFrequently: true })!
    .drawImage(v, sx, sy, box.width / scale, box.height / scale, 0, 0, 320, 320);
  try {
    const result = detector
      ? await detector.detect(crop)
      : { colors: sampleGrid(crop), detections: [] };
    if (disposed || current !== generation) return;
    colors.value = result.colors;
    boxes.value = result.detections;
    const key = colors.value.join('');
    stable.value = previous === key ? stable.value + 1 : 0;
    previous = key;
    latency.value = Math.round(performance.now() - startTime);
  } catch (error) {
    if (current !== generation || disposed) return;
    message.value = `YOLO 推理失败：${(error as Error).message}。请重新加载模型。`;
    const failed = detector;
    detector = null;
    modelName.value = '';
    emit('model', '');
    await failed?.release();
    colors.value = Array(9).fill('?');
    stable.value = 0;
    boxes.value = [];
  }
}
async function loadModel(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  loading.value = true;
  message.value = '';
  try {
    await inference;
    const { YoloDetector } = await import('../lib/yolo');
    const next = await YoloDetector.load(file);
    if (disposed) {
      await next.release();
      return;
    }
    await detector?.release();
    detector = next;
    modelName.value = file.name;
    emit('model', file.name);
    stable.value = 0;
    previous = '';
    boxes.value = [];
  } catch (error) {
    message.value = `模型加载失败：${(error as Error).message}`;
  } finally {
    loading.value = false;
    input.value = '';
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
  void (inference ?? Promise.resolve()).finally(() => detector?.release());
});
defineExpose({ openModelPicker: () => fileInput.value?.click(), stop });
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
    <div ref="viewport" class="camera-viewport" :class="{ active }">
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
      <div ref="guide" class="scan-guide">
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
          <p>将魔方正对镜头，对齐取景框</p>
          <button class="btn primary" :disabled="starting" @click="start">
            <LoaderCircle v-if="starting" class="spin" :size="16" /><Camera v-else :size="16" />{{
              starting ? '正在连接…' : '开启摄像头'
            }}
          </button>
        </div>
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
          ? '请对齐九个色块'
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
    <div class="model-line">
      <span
        ><Cpu :size="14" />{{ modelName ? 'YOLO · ' + modelName : '颜色采样模式'
        }}<small v-if="active">{{ latency }} ms</small></span
      ><button class="text-btn" :disabled="loading" @click="fileInput?.click()">
        <LoaderCircle v-if="loading" :size="13" class="spin" /><Upload v-else :size="13" />{{
          loading ? '加载中…' : modelName ? '更换模型' : '加载 YOLO'
        }}
      </button>
    </div>
    <input ref="fileInput" type="file" accept=".onnx" hidden @change="loadModel" />
  </div>
</template>
