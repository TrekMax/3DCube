import type { Face, Sticker } from './cube';
import { intersectionOverUnion, type CubeDetection } from './localization';

export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  color: Face;
}
export const MODEL_CLASSES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
export function classifyColor(r: number, g: number, b: number): Sticker {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (max < 0.15) return '?';
  const s = max ? d / max : 0;
  if (s < 0.22 && max > 0.38) return 'U';
  if (s < 0.25) return '?';
  let h =
    d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 14 || h >= 345) return 'R';
  if (h < 43) return 'L';
  if (h < 78) return 'D';
  if (h < 175) return 'F';
  if (h < 280) return 'B';
  return '?';
}
export function sampleGrid(canvas: HTMLCanvasElement): Sticker[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const cell = canvas.width / 3,
    radius = Math.max(2, Math.floor(cell * 0.12));
  return Array.from({ length: 9 }, (_, i) => {
    const x = Math.floor(((i % 3) + 0.5) * cell),
      y = Math.floor((Math.floor(i / 3) + 0.5) * cell);
    const pixels = ctx.getImageData(x - radius, y - radius, radius * 2, radius * 2).data;
    const channels: number[][] = [[], [], []];
    for (let p = 0; p < pixels.length; p += 4)
      for (let c = 0; c < 3; c++) channels[c]!.push(pixels[p + c]!);
    const medians = channels.map(
      (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!,
    );
    return classifyColor(medians[0]!, medians[1]!, medians[2]!);
  });
}
interface YoloBox extends CubeDetection {
  classId: number;
}
/** Decode raw YOLOv8/11 or post-NMS predictions, normalized to the model input. */
function decodeYolo(
  data: ArrayLike<number>,
  dims: readonly number[],
  size: number,
  threshold: number,
  classes: number,
): YoloBox[] {
  if (dims.length !== 3 || dims[0] !== 1)
    throw new Error('模型输出必须是 batch=1 的三维检测张量。');
  const channels = classes + 4;
  const raw = dims[1] === channels || dims[2] === channels;
  const processed = !raw && dims[2] === 6;
  if (!raw && !processed)
    throw new Error(
      classes === 1
        ? '定位需要单类 cube 检测模型，请检查模型用途。'
        : '需要六种魔方色块的 YOLO 检测模型，当前模型类别或输出格式不匹配。',
    );
  const transposed = raw && dims[1] === channels;
  const count = transposed ? dims[2]! : dims[1]!;
  const stride = processed ? 6 : channels;
  if (data.length !== count * stride) throw new Error('模型输出数据长度与维度不一致。');
  const at = (i: number, c: number) => data[transposed ? c * count + i : i * stride + c]!;
  const candidates: YoloBox[] = [];
  for (let i = 0; i < count; i++) {
    let cls = processed ? at(i, 5) : 0;
    let score = at(i, 4);
    if (raw)
      for (let c = 1; c < classes; c++)
        if (at(i, c + 4) > score) {
          cls = c;
          score = at(i, c + 4);
        }
    if (
      !Number.isFinite(score) ||
      score < threshold ||
      !Number.isInteger(cls) ||
      cls < 0 ||
      cls >= classes
    )
      continue;
    const x = processed ? at(i, 0) : at(i, 0) - at(i, 2) / 2;
    const y = processed ? at(i, 1) : at(i, 1) - at(i, 3) / 2;
    const width = processed ? at(i, 2) - x : at(i, 2);
    const height = processed ? at(i, 3) - y : at(i, 3);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    candidates.push({
      x: x / size,
      y: y / size,
      width: width / size,
      height: height / size,
      score,
      classId: cls,
    });
  }
  const selected: YoloBox[] = [];
  for (const box of candidates.sort((a, b) => b.score - a.score).slice(0, 300)) {
    // A sticker has only one color: suppress overlapping boxes even across classes.
    if (!selected.some((existing) => intersectionOverUnion(existing, box) > 0.45))
      selected.push(box);
  }
  return selected;
}
export function decodeDetections(
  data: ArrayLike<number>,
  dims: readonly number[],
  size: number,
  threshold = 0.45,
): Detection[] {
  return decodeYolo(data, dims, size, threshold, 6).map(({ classId, ...box }) => ({
    ...box,
    color: MODEL_CLASSES[classId]!,
  }));
}
export function decodeCubeDetections(
  data: ArrayLike<number>,
  dims: readonly number[],
  size: number,
  threshold = 0.5,
): CubeDetection[] {
  return decodeYolo(data, dims, size, threshold, 1).map(({ classId: _classId, ...box }) => box);
}
export function detectionsToGrid(detections: Detection[]): Sticker[] {
  const grid: Sticker[] = Array(9).fill('?'),
    scores = Array(9).fill(0);
  for (const box of detections) {
    const cx = box.x + box.width / 2,
      cy = box.y + box.height / 2;
    if (cx < 0 || cx >= 1 || cy < 0 || cy >= 1 || box.width > 0.55 || box.height > 0.55) continue;
    const c = Math.floor(cx * 3),
      r = Math.floor(cy * 3);
    // Reject stickers too far from the expected cell center (tilt / neighboring faces).
    if (Math.abs(cx - (c + 0.5) / 3) > 0.12 || Math.abs(cy - (r + 0.5) / 3) > 0.12) continue;
    const i = r * 3 + c;
    if (box.score > scores[i]) {
      grid[i] = box.color;
      scores[i] = box.score;
    }
  }
  return grid;
}
