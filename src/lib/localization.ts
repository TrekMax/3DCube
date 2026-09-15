/** Boxes use coordinates normalized to the original, unmirrored camera frame. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CubeDetection extends Rect {
  score: number;
}
export function intersectionOverUnion(a: Rect, b: Rect): number {
  const overlap =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlap / Math.max(1e-9, a.width * a.height + b.width * b.height - overlap);
}
export function letterbox(width: number, height: number, size: number) {
  const scale = Math.min(size / width, size / height);
  const resizedWidth = Math.round(width * scale),
    resizedHeight = Math.round(height * scale);
  return {
    size,
    width,
    height,
    resizedWidth,
    resizedHeight,
    left: Math.floor((size - resizedWidth) / 2),
    top: Math.floor((size - resizedHeight) / 2),
  };
}
export function undoLetterbox<T extends Rect>(box: T, transform: ReturnType<typeof letterbox>): T {
  return {
    ...box,
    x: (box.x * transform.size - transform.left) / transform.resizedWidth,
    y: (box.y * transform.size - transform.top) / transform.resizedHeight,
    width: (box.width * transform.size) / transform.resizedWidth,
    height: (box.height * transform.size) / transform.resizedHeight,
  };
}
export function projectToViewport(
  box: Rect,
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
  fit: 'contain' | 'cover' = 'contain',
): Rect {
  const scale = (fit === 'contain' ? Math.min : Math.max)(viewWidth / width, viewHeight / height);
  return {
    x: (viewWidth - width * scale) / 2 + box.x * width * scale,
    y: (viewHeight - height * scale) / 2 + box.y * height * scale,
    width: box.width * width * scale,
    height: box.height * height * scale,
  };
}
export function chooseCube(boxes: CubeDetection[], previous: Rect | null): CubeDetection | null {
  const visible = boxes.filter(
    (b) => b.x + b.width > 0 && b.y + b.height > 0 && b.x < 1 && b.y < 1,
  );
  if (previous) {
    const nearest = [...visible].sort(
      (a, b) => intersectionOverUnion(b, previous) - intersectionOverUnion(a, previous),
    )[0];
    if (nearest && intersectionOverUnion(nearest, previous) >= 0.25) return nearest;
  }
  return [...visible].sort((a, b) => b.score - a.score)[0] ?? null;
}
export function regionProblem(box: Rect, width: number, height: number): string {
  if (box.x < 0 || box.y < 0 || box.x + box.width > 1.001 || box.y + box.height > 1.001)
    return '请让魔方完整入镜';
  if (Math.min(box.width * width, box.height * height) < 90) return '已找到魔方，请靠近一些';
  const ratio = (box.width * width) / (box.height * height);
  if (ratio < 0.78 || ratio > 1.28) return '已找到魔方，请将一面正对镜头';
  return '';
}
