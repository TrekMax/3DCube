import Cube from 'cubejs';

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];
export type Sticker = Face | '?';
export const COLORS: Record<Sticker, string> = {
  U: '#f4f3ed',
  R: '#e65253',
  F: '#35a887',
  D: '#f5cd4c',
  L: '#f39142',
  B: '#4c85d5',
  '?': '#dce1e7',
};
export const NAMES: Record<Face, string> = { U: '白', R: '红', F: '绿', D: '黄', L: '橙', B: '蓝' };
export const FACE_NAMES: Record<Face, string> = {
  U: '顶面',
  R: '右面',
  F: '前面',
  D: '底面',
  L: '左面',
  B: '后面',
};
export const TOP: Record<Face, Face> = { U: 'B', R: 'U', F: 'U', D: 'F', L: 'U', B: 'U' };
export const SOLVED = FACES.map((f) => f.repeat(9)).join('');
export const DEMO_ALGORITHM = "R U R' F2 D L2 B U2 R2 F' D2 L' B2 U F2";
export function emptyFaces(): Record<Face, Sticker[]> {
  return Object.fromEntries(
    FACES.map((f) => [f, Array.from({ length: 9 }, (_, i) => (i === 4 ? f : '?'))]),
  ) as Record<Face, Sticker[]>;
}
export function splitFaces(state: string): Record<Face, Sticker[]> {
  return Object.fromEntries(
    FACES.map((f, i) => [f, state.slice(i * 9, i * 9 + 9).split('')]),
  ) as Record<Face, Sticker[]>;
}
export function serialize(faces: Record<Face, Sticker[]>): string {
  return FACES.map((f) => faces[f].join('')).join('');
}
export function applyMoves(state: string, algorithm: string): string {
  return Cube.fromString(state).move(algorithm).asString();
}
export function inverseMove(move: string): string {
  return move.endsWith('2') ? move : move.endsWith("'") ? move[0]! : `${move}'`;
}
const parity = (values: number[]) =>
  values.reduce((sum, a, i) => sum + values.slice(i + 1).filter((b) => b < a).length, 0) % 2;
const permutation = (values: number[], length: number) =>
  values.length === length &&
  new Set(values).size === length &&
  values.every((v) => Number.isInteger(v) && v >= 0 && v < length);
export function validateCube(state: string, names: Record<Face, string> = NAMES): string[] {
  if (state.length !== 54 || /[^URFDLB]/.test(state))
    return ['还有未录入的色块，请完成六个面的扫描或手动填色。'];
  const errors: string[] = [];
  for (const f of FACES) {
    const count = [...state].filter((c) => c === f).length;
    if (count !== 9) errors.push(`${names[f]}色有 ${count} 块，应为 9 块。`);
  }
  if (FACES.some((f, i) => state[i * 9 + 4] !== f))
    errors.push('中心颜色与面不对应，请按当前配色的 U、R、F、D、L、B 六个面录入。');
  if (errors.length) return errors;
  try {
    const cube = Cube.fromString(state);
    if (!permutation(cube.cp, 8) || !permutation(cube.ep, 12) || cube.asString() !== state)
      return ['角块或棱块的颜色组合不合法，请检查误识别的颜色和每面的朝向。'];
    if (cube.co.reduce((a, b) => a + b, 0) % 3)
      errors.push('角块方向不合法：请检查是否有角块被扭转，或扫描朝向有误。');
    if (cube.eo.reduce((a, b) => a + b, 0) % 2)
      errors.push('棱块方向不合法：请检查是否有棱块被翻转，或颜色识别有误。');
    if (parity(cube.cp) !== parity(cube.ep))
      errors.push('块位置奇偶性不合法：请检查扫描结果或重新装配过的魔方。');
  } catch {
    errors.push('无法解析魔方，请重新检查色块。');
  }
  return errors;
}
export function moveDescription(move: string, names: Record<Face, string> = NAMES): string {
  if (!move) return `保持${names.U}色在上、${names.F}色在前，准备开始。`;
  const f = move[0] as Face;
  return `正对${FACE_NAMES[f]}（${names[f]}色中心），${move.endsWith('2') ? '旋转 180°' : move.endsWith("'") ? '逆时针旋转 90°' : '顺时针旋转 90°'}。`;
}
export function faceletPosition(face: Face, i: number): [number, number, number] {
  const r = Math.floor(i / 3),
    c = i % 3;
  return {
    U: [c - 1, 1, r - 1],
    R: [1, 1 - r, 1 - c],
    F: [c - 1, 1 - r, 1],
    D: [c - 1, -1, 1 - r],
    L: [-1, 1 - r, c - 1],
    B: [1 - c, 1 - r, -1],
  }[face] as [number, number, number];
}
export function captureView(face: Face) {
  return {
    position: faceletPosition(face, 4).map((v) => v * 9) as [number, number, number],
    up: faceletPosition(TOP[face], 4),
  };
}
export function moveRotation(move: string): {
  axis: 'x' | 'y' | 'z';
  layer: number;
  angle: number;
} {
  const face = move[0] as Face;
  const axis = ({ R: 'x', L: 'x', U: 'y', D: 'y', F: 'z', B: 'z' } as const)[face];
  const layer = ['U', 'R', 'F'].includes(face) ? 1 : -1;
  return {
    axis,
    layer,
    angle: ((-layer * Math.PI) / 2) * (move.endsWith('2') ? 2 : move.endsWith("'") ? -1 : 1),
  };
}
