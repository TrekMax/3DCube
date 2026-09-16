import { FACES, type Face, type Sticker } from './cube';

export function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}
/** Björn Ottosson's public-domain Oklab transform: https://bottosson.github.io/posts/oklab/ */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const linear = (value: number) => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  r = linear(r);
  g = linear(g);
  b = linear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function colorDistance(a: readonly number[], b: readonly number[]): number {
  // Reduce sensitivity to camera illumination, while retaining separation of light/dark stickers.
  return Math.hypot((a[0]! - b[0]!) * 0.65, a[1]! - b[1]!, a[2]! - b[2]!);
}
export function referenceClassifier(colors: Record<Face, string>) {
  const references = FACES.map((face) => ({ face, lab: rgbToOklab(...hexToRgb(colors[face])) }));
  return (r: number, g: number, b: number): Sticker => {
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return '?';
    const pixel = rgbToOklab(r, g, b);
    const ranked = references
      .map((reference) => ({ face: reference.face, distance: colorDistance(pixel, reference.lab) }))
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0]!,
      second = ranked[1]!;
    if (best.distance > 0.18 || second.distance - best.distance < 0.018) return '?';
    return best.face;
  };
}
