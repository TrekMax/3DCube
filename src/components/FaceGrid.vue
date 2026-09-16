<script setup lang="ts">
import type { Sticker } from '../lib/cube';
import { usePalette } from '../lib/usePalette';
const { colors: COLORS, names: NAMES } = usePalette();
defineProps<{
  colors: Sticker[];
  editable?: boolean;
  small?: boolean;
  centerLabel?: string;
  highlighted?: number;
}>();
defineEmits<{ paint: [index: number] }>();
</script>
<template>
  <div class="face-grid" :class="{ small, editable }">
    <component
      :is="editable ? 'button' : 'span'"
      v-for="(color, i) in colors"
      :key="i"
      :type="editable ? 'button' : undefined"
      :disabled="editable && i === 4"
      :class="{ 'missing-sticker': color === '?', 'review-sticker': highlighted === i }"
      :aria-label="`第 ${i + 1} 格：${color === '?' ? '未录入' : NAMES[color] + '色'}${i === 4 ? '，中心固定' : ''}`"
      :style="{ background: COLORS[color] }"
      @click="editable && $emit('paint', i)"
    >
      <span v-if="i === 4 && centerLabel" class="center-letter">{{ centerLabel }}</span
      ><span v-else-if="color === '?'" class="unknown">?</span>
    </component>
  </div>
</template>
