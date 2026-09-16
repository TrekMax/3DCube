<script setup lang="ts">
import { computed, ref } from 'vue';
import { X, Check, RotateCcw } from '@lucide/vue';
import { FACES, FACE_NAMES } from '../lib/cube';
import {
  defaultPalette,
  normalizePalette,
  paletteErrors,
  paletteChangesRecognition,
  type PaletteConfig,
} from '../lib/palette';
const props = defineProps<{ palette: PaletteConfig; hasInput: boolean }>();
const emit = defineEmits<{ save: [palette: PaletteConfig]; close: [] }>();
const draft = ref<PaletteConfig>(JSON.parse(JSON.stringify(props.palette)));
const errors = computed(() => paletteErrors(draft.value));
const resetsScan = computed(
  () => props.hasInput && paletteChangesRecognition(props.palette, draft.value),
);
function save() {
  if (!errors.value.length) emit('save', normalizePalette(draft.value));
}
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      class="modal palette-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="palette-title"
    >
      <div class="modal-heading">
        <div>
          <span class="eyebrow">YOUR CUBE, YOUR COLORS</span>
          <h2 id="palette-title">自定义六面颜色</h2>
        </div>
        <button class="icon-button" aria-label="关闭配色设置" @click="emit('close')">
          <X :size="20" />
        </button>
      </div>
      <p class="palette-intro">
        按实物的六个中心色设置名称和色值。扫描采色、手动校色、方向提示与 3D 视图会同步使用这套配色。
      </p>
      <div class="palette-settings-list">
        <div v-for="face in FACES" :key="face" class="palette-settings-row">
          <div class="palette-face-name">
            <strong>{{ face }}</strong
            ><span>{{ FACE_NAMES[face] }}</span>
          </div>
          <input
            type="color"
            :aria-label="`${face} 面颜色选择器`"
            :value="/^#[0-9a-f]{6}$/i.test(draft.colors[face]) ? draft.colors[face] : '#000000'"
            @input="draft.colors[face] = ($event.target as HTMLInputElement).value"
          />
          <label class="palette-name-input"
            ><span>名称（如紫）</span
            ><input
              v-model="draft.names[face]"
              :aria-label="`${face} 面颜色名称`"
              maxlength="8"
              autocomplete="off"
          /></label>
          <label class="palette-hex-input"
            ><span>HEX 色值</span
            ><input
              v-model="draft.colors[face]"
              :aria-label="`${face} 面 HEX 色值`"
              maxlength="7"
              spellcheck="false"
              autocomplete="off"
          /></label>
        </div>
      </div>
      <p class="palette-opposites">
        相对面：U ↔ D、R ↔ L、F ↔ B。请根据实物中心色的位置填写，六种颜色需有明显区别。
      </p>
      <details class="palette-model-mapping">
        <summary>YOLO 类别映射（使用色块模型时）</summary>
        <p>
          将模型的类别 ID
          对应到当前魔方面。改色不会改变已有模型的识别能力；新增颜色可使用颜色采样，或重新训练色块模型。魔方定位模型不受此设置影响。
        </p>
        <div class="palette-class-grid">
          <label v-for="(_, index) in draft.yoloFaces" :key="index"
            >类别 {{ index
            }}<select v-model="draft.yoloFaces[index]" :aria-label="`YOLO 类别 ${index} 对应面`">
              <option v-for="face in FACES" :key="face" :value="face">
                {{ face }} · {{ draft.names[face] }}色
              </option>
            </select></label
          >
        </div>
      </details>
      <div v-if="errors.length" class="validation-errors palette-errors" role="alert">
        <ul>
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>
      </div>
      <p v-if="resetsScan" class="palette-reset-note">
        颜色或类别映射已改变。应用后将清空已采集的六面和解法，请重新扫描。
      </p>
      <div class="modal-footer palette-footer">
        <button class="text-btn muted" @click="draft = defaultPalette()">
          <RotateCcw :size="14" />恢复默认配色</button
        ><button class="btn secondary" @click="emit('close')">取消</button
        ><button class="btn primary" :disabled="!!errors.length" @click="save">
          <Check :size="15" />{{ resetsScan ? '应用并重新扫描' : '保存配色' }}
        </button>
      </div>
    </section>
  </div>
</template>
