<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  Box,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  ScanLine,
  Layers3,
  WandSparkles,
  RotateCcw,
  RotateCw,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  MousePointer2,
  ShieldCheck,
  X,
  Pencil,
  Eraser,
  LoaderCircle,
  Sparkles,
  Camera,
  Download,
  CheckCheck,
  SlidersHorizontal,
  Palette,
} from '@lucide/vue';
import CubeScene from './components/CubeScene.vue';
import CameraScanner from './components/CameraScanner.vue';
import FaceGrid from './components/FaceGrid.vue';
import ColorSettings from './components/ColorSettings.vue';
import {
  WORKSPACE_KEY,
  LEGACY_DRAFT_KEY,
  restoreWorkspace,
  defaultPalette,
  normalizePalette,
  paletteErrors,
  paletteChangesRecognition,
  type PaletteConfig,
} from './lib/palette';
import { providePalette } from './lib/usePalette';
import {
  FACES,
  FACE_NAMES,
  TOP,
  SOLVED,
  DEMO_ALGORITHM,
  emptyFaces,
  splitFaces,
  serialize,
  applyMoves,
  inverseMove,
  validateCube,
  moveDescription,
  type Face,
  type Sticker,
} from './lib/cube';

function restore() {
  try {
    return restoreWorkspace(
      localStorage.getItem(WORKSPACE_KEY),
      localStorage.getItem(LEGACY_DRAFT_KEY),
    );
  } catch {
    return { version: 2 as const, palette: defaultPalette(), faces: emptyFaces() };
  }
}
const saved = restore();
const palette = ref(saved.palette);
const { colors: COLORS, names: NAMES } = providePalette(palette);
const colorSettings = ref(false);
const faces = ref(saved.faces),
  selected = ref<Face>('U'),
  model = ref('');
const completeFaces = computed(() => FACES.filter((f) => !faces.value[f].includes('?')));
const filled = computed(() =>
  FACES.reduce((sum, f) => sum + faces.value[f].filter((c) => c !== '?').length, 0),
);
const hasInput = computed(() => filled.value > 6);
const scanner = ref<InstanceType<typeof CameraScanner>>(),
  scene = ref<InstanceType<typeof CubeScene>>();
const help = ref(false),
  editor = ref(false),
  draft = ref<Sticker[]>([]),
  paint = ref<Sticker>('U');
const errors = ref<string[]>([]),
  notice = ref(''),
  solving = ref(false),
  solveStatus = ref(''),
  solution = ref<string[] | null>(null);
const current = ref(0),
  playing = ref(false),
  moving = ref(false),
  speed = ref(1);
const source = ref('scan'),
  initial = ref('');
let worker: Worker | null = null,
  requestId = 0,
  playId = 0,
  noticeTimer: ReturnType<typeof setTimeout>,
  solveTimer: ReturnType<typeof setTimeout>;
let modalTrigger: HTMLElement | null = null;
watch(
  () => editor.value || help.value || colorSettings.value,
  async (open) => {
    if (open) {
      modalTrigger = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';
      await nextTick();
      document.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
    } else {
      document.body.style.overflow = '';
      modalTrigger?.focus();
    }
  },
);
const steps = computed(() => solution.value || []);
const done = computed(() => solution.value !== null && current.value === steps.value.length);
const locked = computed(() => moving.value || solving.value);
const currentState = computed(() =>
  solution.value !== null
    ? applyMoves(initial.value, steps.value.slice(0, current.value).join(' '))
    : hasInput.value
      ? serialize(faces.value)
      : SOLVED,
);
const nextMove = computed(() => steps.value[current.value] || '');
const stage = computed(() =>
  solution.value !== null ? 3 : completeFaces.value.length === 6 ? 2 : 1,
);
const countColors = computed(
  () =>
    Object.fromEntries(
      FACES.map((f) => [
        f,
        serialize(faces.value)
          .split('')
          .filter((c) => c === f).length,
      ]),
    ) as Record<Face, number>,
);
function persistWorkspace() {
  try {
    localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({ version: 2, palette: palette.value, faces: faces.value }),
    );
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    /* The active configuration still works when browser storage is unavailable. */
  }
}
watch([faces, palette], persistWorkspace, { deep: true });
function openColorSettings() {
  if (locked.value) return;
  pause();
  colorSettings.value = true;
}
function savePalette(next: PaletteConfig) {
  if (paletteErrors(next).length) return;
  const config = normalizePalette(next);
  const changed = paletteChangesRecognition(palette.value, config);
  if (changed) {
    invalidate();
    faces.value = emptyFaces();
    selected.value = 'U';
    source.value = 'scan';
  }
  palette.value = config;
  if (errors.value.length) errors.value = validateCube(serialize(faces.value), NAMES.value);
  persistWorkspace();
  colorSettings.value = false;
  toast(changed ? '自定义配色已应用，请按新的中心色扫描六面。' : '配色设置已保存。');
}
function toast(text: string) {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = ''), 6500);
}
function pause() {
  playing.value = false;
  playId++;
}
function invalidate() {
  pause();
  solution.value = null;
  current.value = 0;
  errors.value = [];
}
function selectFace(face: Face) {
  if (!locked.value) {
    pause();
    selected.value = face;
  }
}
function openEditor() {
  if (locked.value) return;
  pause();
  draft.value = [...faces.value[selected.value]];
  paint.value = selected.value;
  editor.value = true;
}
function recordFace(colors: Sticker[]) {
  if (locked.value) return;
  if (solution.value !== null) {
    const expected = splitFaces(currentState.value)[selected.value];
    const mismatches = colors.filter((c, i) => c !== expected[i]).length;
    toast(
      mismatches
        ? `当前${FACE_NAMES[selected.value]}有 ${mismatches} 格与第 ${current.value} 步状态不同，请检查动作、识别颜色和持握朝向。`
        : `当前${FACE_NAMES[selected.value]}与 3D 状态一致。核对其他面可进一步确认。`,
    );
    return;
  }
  invalidate();
  faces.value[selected.value] = [...colors];
  source.value = 'scan';
  const remaining = FACES.find((f) => faces.value[f].includes('?'));
  toast(
    `${NAMES.value[selected.value]}色中心面已录入${remaining ? '' : '，六面已就绪，可以生成复原步骤。'}`,
  );
  if (remaining) selected.value = remaining;
}
function saveEditor() {
  invalidate();
  recordFace(draft.value);
  editor.value = false;
}
function rotateDraft() {
  const previous = [...draft.value];
  draft.value = [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => previous[i]!);
}
function demo() {
  if (locked.value) return;
  invalidate();
  faces.value = splitFaces(applyMoves(SOLVED, DEMO_ALGORITHM));
  source.value = 'demo';
  selected.value = 'U';
  toast('已载入演示魔方。点击「生成复原步骤」体验 3D 指导。');
}
function reset() {
  if (locked.value) return;
  invalidate();
  faces.value = emptyFaces();
  source.value = 'scan';
  selected.value = 'U';
  toast('已清空录入，可以开始新的扫描。');
}
function makeWorker() {
  worker = new Worker(new URL('./workers/solver.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    if (event.data.id !== requestId) return;
    if (event.data.status === 'initializing') {
      solveStatus.value = '首次使用，正在准备求解引擎…';
      return;
    }
    clearTimeout(solveTimer);
    solving.value = false;
    if (event.data.error) {
      errors.value = [event.data.error];
      return;
    }
    solution.value = event.data.algorithm.trim() ? event.data.algorithm.trim().split(/\s+/) : [];
    current.value = 0;
    toast(
      steps.value.length
        ? `已生成 ${steps.value.length} 步复原方案。请先摆成${NAMES.value.U}色在上、${NAMES.value.F}色在前。`
        : '这个魔方已经复原了！',
    );
  };
  worker.onerror = () => {
    clearTimeout(solveTimer);
    solving.value = false;
    errors.value = ['求解引擎未能启动，请刷新页面重试。'];
    worker?.terminate();
    worker = null;
  };
}
function solve() {
  if (locked.value) return;
  pause();
  const state = serialize(faces.value);
  errors.value = validateCube(state, NAMES.value);
  if (errors.value.length) return;
  initial.value = state;
  solving.value = true;
  solveStatus.value = '正在计算复原步骤…';
  requestId++;
  if (!worker) makeWorker();
  worker!.postMessage({ id: requestId, state, names: { ...NAMES.value } });
  solveTimer = setTimeout(() => {
    requestId++;
    worker?.terminate();
    worker = null;
    solving.value = false;
    errors.value = ['求解超时，请重试或检查魔方录入。'];
  }, 60000);
}
async function step(direction: 1 | -1, automatic = false) {
  if (
    locked.value ||
    solution.value === null ||
    (direction === 1 && done.value) ||
    (direction === -1 && current.value === 0)
  )
    return;
  if (!automatic) pause();
  moving.value = true;
  const index = current.value + direction;
  const move = direction === 1 ? steps.value[current.value]! : inverseMove(steps.value[index]!);
  const state = applyMoves(initial.value, steps.value.slice(0, index).join(' '));
  try {
    await scene.value?.turn(move, state, 760 / speed.value);
    current.value = index;
    await nextTick();
  } finally {
    moving.value = false;
  }
  if (done.value) pause();
}
async function togglePlayback() {
  if (playing.value) {
    pause();
    return;
  }
  if (locked.value || !steps.value.length) return;
  if (done.value) current.value = 0;
  playing.value = true;
  const id = ++playId;
  while (playing.value && id === playId && !done.value) {
    await step(1, true);
    await new Promise((resolve) => setTimeout(resolve, 420 / speed.value));
  }
  if (id === playId) playing.value = false;
}
function seek(index: number) {
  if (locked.value) return;
  pause();
  current.value = index;
}
function exportState() {
  const payload = {
    version: 2,
    palette: palette.value,
    faceOrder: 'URFDLB',
    facelets: serialize(faces.value),
    solution: solution.value,
    completedSteps: current.value,
    source: source.value,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cube-guide.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function handleKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    editor.value = false;
    help.value = false;
    colorSettings.value = false;
  }
  if ((editor.value || help.value || colorSettings.value) && event.key === 'Tab') {
    const focusable = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="dialog"] button:not(:disabled), [role="dialog"] input, [role="dialog"] select, [role="dialog"] a[href]',
      ),
    ];
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  if (
    editor.value ||
    help.value ||
    colorSettings.value ||
    /INPUT|TEXTAREA|SELECT|BUTTON/.test((event.target as HTMLElement)?.tagName)
  )
    return;
  if (solution.value !== null && event.key === 'ArrowRight') {
    event.preventDefault();
    void step(1);
  }
  if (solution.value !== null && event.key === 'ArrowLeft') {
    event.preventDefault();
    void step(-1);
  }
  if (solution.value !== null && event.code === 'Space') {
    event.preventDefault();
    void togglePlayback();
  }
}
window.addEventListener('keydown', handleKey);
onBeforeUnmount(() => {
  pause();
  worker?.terminate();
  clearTimeout(noticeTimer);
  clearTimeout(solveTimer);
  window.removeEventListener('keydown', handleKey);
});
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="方序首页"
        ><span class="brand-mark"><Box :size="25" :stroke-width="1.6" /></span
        ><span class="brand-name">方序<span>CUBE GUIDE</span></span></a
      >
      <nav>
        <span class="nav-active">复原工作台</span
        ><button
          @click="
            help = true;
            pause();
          "
        >
          使用指南<ArrowUpRight :size="13" />
        </button>
      </nav>
      <div class="header-right">
        <span class="local-badge"><span />本地运行 · 隐私优先</span
        ><button
          class="icon-button"
          aria-label="打开使用帮助"
          @click="
            help = true;
            pause();
          "
        >
          <CircleHelp :size="19" />
        </button>
      </div>
    </div>
  </header>
  <main>
    <section class="hero">
      <div>
        <div class="eyebrow"><span />A LITTLE GUIDANCE. A PERFECT SOLVE.</div>
        <h1>把每一步，<span>转对。</span><span class="hero-cube">✳</span></h1>
        <p>用镜头读懂魔方，跟着 3D 指引，让六面重新归位。</p>
      </div>
      <button class="btn secondary demo-btn" :disabled="locked" @click="demo">
        <Play :size="15" />体验演示魔方<ArrowUpRight :size="14" />
      </button>
    </section>
    <section class="workflow" aria-label="复原进度">
      <div :class="{ active: stage === 1, complete: stage > 1 }">
        <span class="step-number"><Check v-if="stage > 1" :size="15" /><span v-else>01</span></span
        ><span><strong>扫描六面</strong><small>记录魔方颜色</small></span>
      </div>
      <div class="workflow-line" />
      <div :class="{ active: stage === 2, complete: stage > 2 }">
        <span class="step-number"><Check v-if="stage > 2" :size="15" /><span v-else>02</span></span
        ><span><strong>检查与求解</strong><small>确认你的魔方状态</small></span>
      </div>
      <div class="workflow-line" />
      <div :class="{ active: stage === 3 }">
        <span class="step-number">03</span
        ><span><strong>跟随 3D 复原</strong><small>一次只需转动一步</small></span>
      </div>
      <span class="workflow-note"
        >{{ stage === 3 ? '你的复原旅程正在进行' : '准备好你的三阶魔方' }}<Sparkles :size="15"
      /></span>
    </section>

    <div class="workspace">
      <section class="panel camera-panel">
        <CameraScanner
          ref="scanner"
          :face="selected"
          :disabled="locked || playing || colorSettings || editor || help"
          @capture="recordFace"
          @model="model = $event"
        />
        <div class="manual-row">
          <span>{{ solution !== null ? '采集指定面可核对当前步骤' : '识别不准？你也可以' }}</span
          ><button class="text-btn" :disabled="locked" @click="openEditor">
            <Pencil :size="13" />手动{{ hasInput ? '校正' : '录入' }}颜色<ChevronRight :size="13" />
          </button>
        </div>
      </section>
      <section class="panel viewer-panel">
        <div class="panel-heading">
          <div class="heading-title">
            <span class="icon-tile"><Box :size="18" /></span>
            <h2>你的 3D 魔方</h2>
            <span class="tiny-tag">INTERACTIVE</span>
          </div>
          <button
            class="icon-button"
            title="重置 3D 视角"
            aria-label="重置 3D 视角"
            @click="scene?.resetView()"
          >
            <RotateCcw :size="16" />
          </button>
        </div>
        <div class="viewer-body">
          <div class="viewer-tags">
            <span
              ><span class="small-dot" :class="{ orange: source === 'demo', green: done }" />{{
                done
                  ? '已完成复原'
                  : source === 'demo'
                    ? '演示魔方'
                    : hasInput
                      ? '已录入的魔方'
                      : '魔方示意'
              }}</span
            ><span class="mono">3 × 3 × 3</span>
          </div>
          <CubeScene ref="scene" :state="currentState" :next-move="nextMove" />
          <div v-if="solving" class="solver-overlay">
            <LoaderCircle class="spin" :size="28" /><strong>{{ solveStatus }}</strong
            ><span>计算在后台进行，首次准备可能需要数秒。</span>
          </div>
          <div class="orientation-label">
            <span class="axis-y">U</span><span class="axis-z">F</span><span class="axis-x">R</span
            ><svg width="50" height="50" viewBox="0 0 50 50">
              <path
                d="M25 26V7M25 26 8 36M25 26 42 36"
                fill="none"
                stroke="#b4bcc6"
                stroke-width="1.5"
              />
            </svg>
          </div>
          <div class="drag-hint"><MousePointer2 :size="13" />拖动旋转 · 滚轮缩放</div>
        </div>
        <div v-if="solution === null" class="viewer-footer">
          <span class="footer-icon"><Layers3 :size="20" /></span>
          <div>
            <strong>{{
              completeFaces.length === 6 ? '六面已就绪，准备复原' : '真实魔方，数字映射'
            }}</strong>
            <p>
              {{
                completeFaces.length === 6
                  ? '确认颜色后，生成你的专属复原步骤。'
                  : '录入的每一个色块，都会同步到这里。'
              }}
            </p>
          </div>
          <span class="scan-count">{{ completeFaces.length }}<small>/ 6 面</small></span>
        </div>
        <div v-else class="solution-footer">
          <div class="move-instruction">
            <span class="current-move" :class="{ success: done }"
              ><CheckCheck v-if="done" :size="26" /><template v-else>{{ nextMove }}</template></span
            >
            <div>
              <strong>{{
                done
                  ? '六面归位，做得漂亮。'
                  : `第 ${current + 1} 步 · ${FACE_NAMES[nextMove[0] as Face]}`
              }}</strong>
              <p>
                {{
                  done
                    ? '已播放全部步骤，可用摄像头逐面核对实物。'
                    : moveDescription(nextMove, NAMES)
                }}
              </p>
            </div>
            <span class="step-counter">{{ current }} / {{ steps.length }}</span>
          </div>
          <div class="playback-controls">
            <div class="playback-buttons">
              <button
                class="icon-button"
                :disabled="locked || current === 0"
                aria-label="回到第一步"
                @click="seek(0)"
              >
                <SkipBack :size="17" /></button
              ><button
                class="icon-button"
                :disabled="locked || current === 0"
                aria-label="上一步"
                @click="step(-1)"
              >
                <ArrowLeft :size="18" /></button
              ><button
                class="play-button"
                :disabled="solving || (moving && !playing) || !steps.length"
                :aria-label="playing ? '暂停播放' : '自动播放'"
                @click="togglePlayback"
              >
                <Pause v-if="playing" :size="19" fill="currentColor" /><Play
                  v-else
                  :size="18"
                  fill="currentColor"
                /></button
              ><button
                class="icon-button"
                :disabled="locked || done"
                aria-label="下一步"
                @click="step(1)"
              >
                <ArrowRight :size="18" /></button
              ><button
                class="icon-button"
                :disabled="locked || done"
                aria-label="跳到最后一步"
                @click="seek(steps.length)"
              >
                <SkipForward :size="17" />
              </button>
            </div>
            <label class="speed-control"
              >速度<select v-model="speed" aria-label="动画速度">
                <option :value="0.5">0.5×</option>
                <option :value="1">1×</option>
                <option :value="1.5">1.5×</option>
                <option :value="2">2×</option>
              </select></label
            >
          </div>
        </div>
      </section>
    </div>

    <section class="panel face-panel">
      <div class="face-panel-heading">
        <div>
          <h2>
            六面采集<span>{{ completeFaces.length }} / 6</span>
          </h2>
          <p>按中心颜色选择面，点击「手动录入」可填写或校正色块。</p>
        </div>
        <div class="face-actions">
          <button class="text-btn" :disabled="locked" @click="openColorSettings">
            <Palette :size="14" />自定义配色
          </button>
          <button class="text-btn muted" :disabled="locked || !hasInput" @click="exportState">
            <Download :size="14" /><span>导出</span></button
          ><button class="text-btn muted" :disabled="locked || !hasInput" @click="reset">
            <RotateCcw :size="14" />重新扫描
          </button>
        </div>
      </div>
      <div class="face-list">
        <button
          v-for="(face, i) in FACES"
          :key="face"
          class="face-card"
          :class="{ selected: selected === face, recorded: completeFaces.includes(face) }"
          :disabled="locked"
          :aria-label="`选择${NAMES[face]}色中心${FACE_NAMES[face]}`"
          @click="selectFace(face)"
        >
          <span class="face-card-top"
            ><span
              >{{ String(i + 1).padStart(2, '0') }}<strong>{{ FACE_NAMES[face] }}</strong></span
            ><Check v-if="completeFaces.includes(face)" :size="14" /><span
              v-else
              class="unrecorded-dot" /></span
          ><FaceGrid :colors="faces[face]" small :center-label="face" /><span
            class="face-card-bottom"
            ><span>{{ NAMES[face] }}色中心</span
            ><span>{{
              completeFaces.includes(face) ? '已采集' : selected === face ? '待扫描' : '未采集'
            }}</span></span
          >
        </button>
      </div>
      <div class="face-panel-footer">
        <div class="capture-progress">
          <div class="progress-bars">
            <span
              v-for="face in FACES"
              :key="face"
              :class="{ filled: completeFaces.includes(face) }"
            />
          </div>
          <span>{{
            solution !== null
              ? `保持${NAMES.U}色朝上、${NAMES.F}色朝前，按步骤转动`
              : completeFaces.length === 6
                ? '六面采集完成，可以检查并求解'
                : `还需采集 ${6 - completeFaces.length} 个面`
          }}</span>
        </div>
        <button
          class="btn primary solve-button"
          :disabled="completeFaces.length < 6 || locked"
          @click="solve"
        >
          <LoaderCircle v-if="solving" :size="16" class="spin" /><WandSparkles
            v-else
            :size="16"
          />{{ solving ? '正在求解…' : solution !== null ? '重新计算步骤' : '生成复原步骤'
          }}<ArrowRight :size="16" />
        </button>
      </div>
      <div v-if="errors.length" class="validation-errors" role="alert">
        <strong>请先检查以下问题</strong>
        <ul>
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>
        <div class="color-counts">
          <span v-for="f in FACES" :key="f" :class="{ invalid: countColors[f] !== 9 }"
            ><i :style="{ background: COLORS[f] }" />{{ NAMES[f] }} {{ countColors[f] }}/9</span
          >
        </div>
      </div>
    </section>

    <section v-if="solution !== null && steps.length" class="panel algorithm-panel">
      <div class="face-panel-heading">
        <div>
          <h2>
            复原路线<span>{{ steps.length }} 步</span>
          </h2>
          <p>橙色标记下一步。点击任意步骤，预览完成该步后的状态。</p>
        </div>
        <span class="keyboard-hint">← → 单步 · 空格 播放</span>
      </div>
      <div class="algorithm">
        <button
          v-for="(move, i) in steps"
          :key="i"
          :disabled="locked"
          :class="{ past: i < current, next: i === current }"
          :aria-label="`预览第 ${i + 1} 步 ${move} 完成后的状态`"
          @click="seek(i + 1)"
        >
          <small>{{ String(i + 1).padStart(2, '0') }}</small
          >{{ move }}<Check v-if="i < current" :size="10" />
        </button>
      </div>
    </section>
    <section class="tips">
      <article>
        <span class="tip-icon"><ScanLine :size="19" /></span>
        <div>
          <h3>光线均匀，识别更准确</h3>
          <p>避开反光与阴影，让九个色块完整入镜。</p>
        </div>
      </article>
      <article>
        <span class="tip-icon"><RotateCw :size="19" /></span>
        <div>
          <h3>只换面，不打乱</h3>
          <p>扫描时整体转动魔方，保持色块位置不变。</p>
        </div>
      </article>
      <article>
        <span class="tip-icon"><ShieldCheck :size="19" /></span>
        <div>
          <h3>你的镜头，只属于你</h3>
          <p>识别与求解在浏览器本地完成，图像不上传。</p>
        </div>
      </article>
    </section>
  </main>
  <footer class="site-footer">
    <span>方序 <span class="footer-separator">/</span> 每一次转动，都离答案更近。</span
    ><span>Vue · Three.js · Ultralytics YOLO<span class="footer-dot">●</span></span>
  </footer>
  <Transition name="toast"
    ><div v-if="notice" class="toast-message" role="status">
      <Check :size="18" />{{ notice
      }}<button aria-label="关闭提示" @click="notice = ''"><X :size="15" /></button></div
  ></Transition>

  <ColorSettings
    v-if="colorSettings"
    :palette="palette"
    :has-input="hasInput"
    @save="savePalette"
    @close="colorSettings = false"
  />
  <div v-if="editor" class="modal-backdrop" @click.self="editor = false">
    <section
      class="modal editor-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-title"
    >
      <div class="modal-heading">
        <div>
          <span class="eyebrow">FACE EDITOR</span>
          <h2 id="editor-title">{{ NAMES[selected] }}色中心 · {{ FACE_NAMES[selected] }}</h2>
        </div>
        <button class="icon-button" aria-label="关闭颜色编辑" @click="editor = false">
          <X :size="20" />
        </button>
      </div>
      <p class="editor-tip">
        正对{{ NAMES[selected] }}色中心，{{
          NAMES[TOP[selected]]
        }}色中心朝上。<br />选择颜色，再点击对应的色块；中心颜色固定。
      </p>
      <div class="editor-orientation">
        <span class="color-dot" :style="{ background: COLORS[TOP[selected]] }" />{{
          NAMES[TOP[selected]]
        }}色中心朝上 ↑
      </div>
      <FaceGrid
        :colors="draft"
        editable
        :center-label="selected"
        @paint="(i) => (draft[i] = paint)"
      />
      <div class="palette">
        <button
          v-for="f in FACES"
          :key="f"
          :class="{ chosen: paint === f }"
          :aria-label="`使用${NAMES[f]}色`"
          @click="paint = f"
        >
          <span :style="{ background: COLORS[f] }"><Check v-if="paint === f" :size="18" /></span
          >{{ NAMES[f] }}</button
        ><button :class="{ chosen: paint === '?' }" aria-label="使用橡皮擦" @click="paint = '?'">
          <span class="eraser"><Eraser :size="18" /></span>擦除
        </button>
      </div>
      <div class="editor-tools">
        <button class="text-btn" @click="rotateDraft">
          <RotateCw :size="14" />顺时针转动录入图</button
        ><button class="text-btn muted" @click="draft = Array(9).fill(selected)">
          填满{{ NAMES[selected] }}色
        </button>
      </div>
      <div class="modal-footer">
        <button class="btn secondary" @click="editor = false">取消</button
        ><button class="btn primary" @click="saveEditor"><Check :size="15" />保存此面</button>
      </div>
    </section>
  </div>
  <div v-if="help" class="modal-backdrop" @click.self="help = false">
    <section class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="modal-heading">
        <div>
          <span class="eyebrow">A SMALL GUIDE</span>
          <h2 id="help-title">六个面，一条复原路线。</h2>
        </div>
        <button class="icon-button" aria-label="关闭使用指南" @click="help = false">
          <X :size="20" />
        </button>
      </div>
      <div class="help-section">
        <h3><Camera :size="17" />1. 记录六面</h3>
        <p>
          当前配色：{{ NAMES.U }}顶 U、{{ NAMES.R }}右 R、{{ NAMES.F }}前 F、{{ NAMES.D }}底 D、{{
            NAMES.L
          }}左 L、{{ NAMES.B }}后 B。可在「六面采集 →
          自定义配色」修改六种颜色和名称。按照取景框下方的中心色和朝上色提示，整体转动魔方，再采集当前面。摄像头没有镜像处理。
        </p>
        <p>
          加载定位模型后，将魔方放在画面任意位置，检测框会自动跟随，无需对齐固定取景框。保持一个面正对镜头、光线均匀，位置和颜色稳定后点击「采集此面」。目标丢失时自动暂停采集。未加载定位模型时，使用固定九宫格采集。
        </p>
      </div>
      <div class="help-section">
        <h3><SlidersHorizontal :size="17" />2. 使用 Ultralytics YOLO</h3>
        <p>
          点击「加载定位模型」，选择单类 cube 的 ONNX
          检测模型。程序先检测全画面中的魔方，再自动裁剪检测区域采色。仅定位不能判断实物转动方向或消除透视，仍需将一面正对镜头。
        </p>
        <p>
          「加载色块模型」可另外启用六色 YOLO 识别，类别顺序为
          white、red、green、yellow、orange、blue；未加载时使用颜色采样。两个模型均需训练，项目提供对应训练和导出配置。不要使用通用
          COCO 权重替代魔方专用模型。
        </p>
        <button
          class="btn secondary compact"
          @click="
            help = false;
            scanner?.openModelPicker();
          "
        >
          加载定位模型<ArrowUpRight :size="14" />
        </button>
      </div>
      <div class="help-section">
        <h3><Box :size="17" />3. 跟着 3D 转动</h3>
        <p>
          求解后先把实物摆成{{ NAMES.U }}色在上、{{ NAMES.F }}色在前。R / L / U / D / F / B 分别是右
          / 左 / 上 / 下 / 前 / 后面；旋转方向始终按正对正在转动的那个面判断。
        </p>
        <div class="notation">
          <span><b>R</b>顺时针 90°</span><span><b>R′</b>逆时针 90°</span
          ><span><b>R2</b>旋转 180°</span>
        </div>
        <p>
          拖动 3D
          视角不会改变魔方状态。做完一步后点击下一步；自动播放仅为动画演示。需要核对实物时暂停播放，选择要检查的面并采集，程序会比较该面与当前步骤的颜色。
        </p>
      </div>
      <button class="btn primary full" @click="help = false">
        开始我的复原<ArrowRight :size="16" />
      </button>
    </section>
  </div>
</template>
