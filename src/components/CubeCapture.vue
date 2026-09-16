<script setup lang="ts">
import { computed } from 'vue';
import { Check, Focus, Pencil } from '@lucide/vue';
import { FACES, FACE_NAMES, TOP, type Face, type Sticker } from '../lib/cube';
import { usePalette } from '../lib/usePalette';
import FaceGrid from './FaceGrid.vue';
const props = defineProps<{
  faces: Record<Face, Sticker[]>;
  selected: Face;
  disabled: boolean;
}>();
const emit = defineEmits<{ select: [face: Face]; focus: []; edit: [index?: number] }>();
const { colors, names } = usePalette();
const missing = (face: Face) => props.faces[face].filter((c) => c === '?').length;
const remaining = computed(() => missing(props.selected));
</script>
<template>
  <div class="cube-capture">
    <div class="capture-heading">
      <strong>3D 六面采集</strong>
      <span>点击魔方面选中 · 灰色 ? 表示未录入</span>
    </div>
    <div class="capture-face-tabs" aria-label="3D 采集面选择">
      <button
        v-for="face in FACES"
        :key="face"
        :disabled="disabled"
        :aria-label="`3D 采集：${FACE_NAMES[face]}（${names[face]}色）`"
        :aria-pressed="selected === face"
        @click="emit('select', face)"
      >
        <i :style="{ background: colors[face] }" />{{ face }}
        <Check v-if="!missing(face)" :size="12" /><small v-else>{{ 9 - missing(face) }}/9</small>
      </button>
    </div>
    <div class="capture-selected">
      <FaceGrid
        :colors="faces[selected]"
        small
        :editable="!disabled"
        :center-label="selected"
        @paint="emit('edit', $event)"
      />
      <div class="capture-face-info" aria-live="polite">
        <strong>{{ FACE_NAMES[selected] }} · {{ names[selected] }}色中心</strong>
        <p>{{ names[TOP[selected]] }}色中心朝上 ↑</p>
        <span :class="{ incomplete: remaining > 0 }">{{
          remaining ? `还缺 ${remaining} 格，请采集或手动补齐` : '9 格已记录，可重新采集或校色'
        }}</span>
      </div>
      <div class="capture-face-actions">
        <button class="text-btn muted" :disabled="disabled" @click="emit('focus')">
          <Focus :size="13" />正对当前面
        </button>
        <button class="text-btn" :disabled="disabled" @click="emit('edit')">
          <Pencil :size="13" />{{ remaining ? '补齐此面' : '校正此面' }}
        </button>
      </div>
    </div>
    <p class="capture-orientation-note">
      按 3D 朝向整体转动实物，再用摄像头采集；拖动视角不会改变已录入的颜色。
    </p>
  </div>
</template>
