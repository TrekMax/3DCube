import { COLORS, FACES, NAMES, emptyFaces, type Face, type Sticker } from './cube';
import { colorDistance, hexToRgb, rgbToOklab } from './color';

export interface PaletteConfig {
  version: 1;
  colors: Record<Face, string>;
  names: Record<Face, string>;
  /** Index is the YOLO class ID, value is the corresponding logical cube face. */
  yoloFaces: Face[];
}
export function defaultPalette(): PaletteConfig {
  return {
    version: 1,
    colors: Object.fromEntries(FACES.map((f) => [f, COLORS[f]])) as Record<Face, string>,
    names: { ...NAMES },
    yoloFaces: [...FACES],
  };
}
const cleanName = (name: string) => name.trim().replace(/(.+)色$/, '$1');
export function paletteErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['配色配置格式不正确。'];
  const data = value as Partial<PaletteConfig>,
    errors: string[] = [];
  if (data.version !== 1 || !data.colors || !data.names) return ['配色配置格式不正确。'];
  for (const face of FACES) {
    const name = data.names[face],
      color = data.colors[face];
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 8)
      errors.push(`${face} 面名称需为 1–8 个字符。`);
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
      errors.push(`${face} 面请输入完整色值，例如 #A855F7。`);
  }
  if (
    !Array.isArray(data.yoloFaces) ||
    data.yoloFaces.length !== 6 ||
    new Set(data.yoloFaces).size !== 6 ||
    !data.yoloFaces.every((f) => FACES.includes(f))
  )
    errors.push('YOLO 类别必须与六个面一一对应，不能重复。');
  if (errors.length) return errors;
  if (new Set(FACES.map((f) => cleanName(data.names![f]))).size !== 6)
    errors.push('六个颜色名称不能重复。');
  for (let i = 0; i < FACES.length; i++)
    for (let j = i + 1; j < FACES.length; j++) {
      const a = FACES[i]!,
        b = FACES[j]!;
      if (
        colorDistance(
          rgbToOklab(...hexToRgb(data.colors[a])),
          rgbToOklab(...hexToRgb(data.colors[b])),
        ) < 0.035
      )
        errors.push(`${a} 面与 ${b} 面的颜色太接近，请使用可区分的六种颜色。`);
    }
  return errors;
}
export function normalizePalette(config: PaletteConfig): PaletteConfig {
  return {
    version: 1,
    colors: Object.fromEntries(FACES.map((f) => [f, config.colors[f].toLowerCase()])) as Record<
      Face,
      string
    >,
    names: Object.fromEntries(FACES.map((f) => [f, cleanName(config.names[f])])) as Record<
      Face,
      string
    >,
    yoloFaces: [...config.yoloFaces],
  };
}
export function paletteChangesRecognition(before: PaletteConfig, after: PaletteConfig) {
  return (
    FACES.some((f) => before.colors[f].toLowerCase() !== after.colors[f].toLowerCase()) ||
    before.yoloFaces.some((f, i) => f !== after.yoloFaces[i])
  );
}
export const WORKSPACE_KEY = 'cube-guide-workspace-v2';
export const LEGACY_DRAFT_KEY = 'cube-guide-draft-v1';
export interface Workspace {
  version: 2;
  palette: PaletteConfig;
  faces: Record<Face, Sticker[]>;
}
function validFaces(data: unknown): data is Record<Face, Sticker[]> {
  return (
    !!data &&
    typeof data === 'object' &&
    FACES.every((f) => {
      const face = (data as Record<string, unknown>)[f];
      return (
        Array.isArray(face) &&
        face.length === 9 &&
        face[4] === f &&
        face.every((c) => c === '?' || FACES.includes(c))
      );
    })
  );
}
export function restoreWorkspace(current: string | null, legacy: string | null): Workspace {
  const fresh = (): Workspace => ({ version: 2, palette: defaultPalette(), faces: emptyFaces() });
  if (current !== null) {
    try {
      const data = JSON.parse(current);
      if (data?.version === 2 && paletteErrors(data.palette).length === 0)
        return {
          version: 2,
          palette: normalizePalette(data.palette),
          faces: validFaces(data.faces) ? data.faces : emptyFaces(),
        };
    } catch {
      /* Discard an invalid profile and its dependent scan data together. */
    }
    return fresh();
  }
  try {
    const faces = JSON.parse(legacy || 'null');
    if (validFaces(faces)) return { ...fresh(), faces };
  } catch {}
  return fresh();
}
