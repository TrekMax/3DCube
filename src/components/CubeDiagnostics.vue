<script setup lang="ts">
import { FACE_NAMES, type CubeAnalysis, type Face } from '../lib/cube';
import { usePalette } from '../lib/usePalette';
defineProps<{ pieces: NonNullable<CubeAnalysis['pieces']> }>();
const emit = defineEmits<{ review: [face: Face, index: number] }>();
const { colors, names } = usePalette();
</script>
<template>
  <section class="cube-diagnostics" aria-label="具体核对位置">
    <p>六种颜色各有 9 格，但颜色数量正确还不够，色块的位置与方向也需要一致。</p>
    <template v-if="pieces.edgeFlipCount % 2">
      <h3>从这些棱块记录开始核对</h3>
      <p>
        当前数据有
        {{
          pieces.edgeFlipCount
        }}
        个反向棱块记录，总数为奇数。以下位置只是核对线索，不能据此断定实物被翻转，也不能唯一确定哪格颜色有误。
      </p>
      <div class="edge-review-list">
        <article v-for="edge in pieces.flippedEdges" :key="edge.position">
          <strong>{{ edge.stickers.map((s) => FACE_NAMES[s.face]).join(' / ') }}相邻棱块</strong>
          <div class="edge-review-actions">
            <button
              v-for="sticker in edge.stickers"
              :key="sticker.face"
              class="btn secondary compact"
              :aria-label="`核对${FACE_NAMES[sticker.face]}第 ${sticker.index + 1} 格`"
              @click="emit('review', sticker.face, sticker.index)"
            >
              <i :style="{ background: colors[sticker.color] }" />
              {{ FACE_NAMES[sticker.face] }}第 {{ sticker.index + 1 }} 格 ·
              {{ names[sticker.color] }}色
            </button>
          </div>
        </article>
      </div>
      <p>
        每面按页面指定的相邻中心色朝上，从左上到右下编号 1–9；第 8
        格是最下面一行的中间格。点击按钮可打开对应面并标出该格。
      </p>
    </template>
    <template v-if="pieces.cornerParity !== pieces.edgeParity">
      <h3>还需核对整体位置关系</h3>
      <p>
        角块与棱块的位置组合不一致，不能仅靠颜色数量定位错误。请一并核对各面的朝上方向，并确认采集六面期间只整体转动魔方，没有转动单层。
      </p>
    </template>
    <p>先对照实物校色；如果颜色都一致，请按方向提示重新采集。仅凭当前数据无法安全推断正确配色。</p>
  </section>
</template>
