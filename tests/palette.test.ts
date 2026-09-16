import { describe, expect, it } from 'vitest';
import {
  FACES,
  SOLVED,
  emptyFaces,
  splitFaces,
  validateCube,
  moveDescription,
} from '../src/lib/cube';
import {
  defaultPalette,
  normalizePalette,
  paletteErrors,
  paletteChangesRecognition,
  restoreWorkspace,
} from '../src/lib/palette';
import { createColorClassifier, decodeDetections } from '../src/lib/vision';
import { rgbToOklab, hexToRgb } from '../src/lib/color';

describe('custom color configuration', () => {
  it('accepts defaults and a six-color palette containing purple and pink', () => {
    expect(paletteErrors(defaultPalette())).toEqual([]);
    const profile = defaultPalette();
    profile.colors.U = '#a855f7';
    profile.names.U = '紫';
    profile.colors.D = '#f472b6';
    profile.names.D = '粉';
    expect(paletteErrors(profile)).toEqual([]);
  });
  it('rejects invalid, indistinguishable or ambiguously named colors', () => {
    const profile = defaultPalette();
    profile.colors.U = 'not-a-color';
    expect(paletteErrors(profile).join()).toMatch(/完整色值/);
    profile.colors.U = profile.colors.R;
    expect(paletteErrors(profile).join()).toMatch(/太接近/);
    const named = defaultPalette();
    named.names.U = '红色';
    expect(paletteErrors(named).join()).toMatch(/名称不能重复/);
  });
  it('requires one distinct face for each YOLO class', () => {
    const profile = defaultPalette();
    profile.yoloFaces[0] = 'R';
    expect(paletteErrors(profile).join()).toMatch(/一一对应/);
  });
  it('normalizes names and hex without mutating the supplied profile', () => {
    const profile = defaultPalette();
    profile.colors.U = '#A855F7';
    profile.names.U = ' 紫色 ';
    const normalized = normalizePalette(profile);
    expect(normalized.colors.U).toBe('#a855f7');
    expect(normalized.names.U).toBe('紫');
    expect(profile.colors.U).toBe('#A855F7');
  });
  it('preserves a scan after renaming but invalidates it after color or class changes', () => {
    const before = defaultPalette(),
      after = defaultPalette();
    after.names.U = '米白';
    expect(paletteChangesRecognition(before, after)).toBe(false);
    after.colors.U = '#a855f7';
    expect(paletteChangesRecognition(before, after)).toBe(true);
    after.colors.U = before.colors.U;
    [after.yoloFaces[0], after.yoloFaces[1]] = [after.yoloFaces[1]!, after.yoloFaces[0]!];
    expect(paletteChangesRecognition(before, after)).toBe(true);
  });
});
describe('camera sampling and model labels', () => {
  it('uses the reference Oklab white and primary red coordinates', () => {
    const white = rgbToOklab(255, 255, 255),
      red = rgbToOklab(255, 0, 0);
    expect(white[0]).toBeCloseTo(1, 6);
    expect(white[1]).toBeCloseTo(0, 6);
    expect(white[2]).toBeCloseTo(0, 6);
    expect(red[0]).toBeCloseTo(0.627955, 5);
    expect(red[1]).toBeCloseTo(0.224863, 5);
    expect(red[2]).toBeCloseTo(0.125846, 5);
  });
  it('recognizes custom colors on all six faces, including black', () => {
    const profile = defaultPalette();
    profile.colors.U = '#a855f7';
    profile.colors.D = '#f472b6';
    profile.colors.B = '#171717';
    const classify = createColorClassifier(profile.colors);
    for (const face of FACES) expect(classify(...hexToRgb(profile.colors[face]))).toBe(face);
    expect(classify(166, 83, 242)).toBe('U');
  });
  it('changes the recognized face when center colors are reassigned', () => {
    const profile = defaultPalette();
    [profile.colors.U, profile.colors.R] = [profile.colors.R, profile.colors.U];
    const classify = createColorClassifier(profile.colors);
    expect(classify(245, 245, 239)).toBe('R');
    expect(classify(...hexToRgb(profile.colors.U))).toBe('U');
  });
  it('rejects low-confidence and ambiguous samples instead of forcing a face', () => {
    const profile = defaultPalette();
    profile.colors.U = '#a855f7';
    expect(createColorClassifier(profile.colors)(0, 0, 0)).toBe('?');
    profile.colors.R = profile.colors.U;
    expect(createColorClassifier(profile.colors)(...hexToRgb(profile.colors.U))).toBe('?');
  });
  it('maps the trained class ID to the configured face for both raw and processed output', () => {
    const faces = [...FACES];
    [faces[0], faces[1]] = [faces[1]!, faces[0]!];
    expect(
      decodeDetections([50, 50, 40, 40, 0.9, 0, 0, 0, 0, 0], [1, 1, 10], 300, 0.45, faces)[0]
        ?.color,
    ).toBe('R');
    expect(decodeDetections([10, 10, 90, 90, 0.9, 1], [1, 1, 6], 300, 0.45, faces)[0]?.color).toBe(
      'U',
    );
    expect(() => decodeDetections([], [1, 1, 10], 300, 0.45, Array(6).fill('U'))).toThrow(/映射/);
  });
  it('uses custom color names in validation and move guidance', () => {
    const profile = defaultPalette();
    profile.names.U = '紫';
    expect(validateCube(SOLVED.replace('R', 'U'), profile.names).join()).toContain('紫色有 10 块');
    expect(moveDescription('U', profile.names)).toContain('紫色中心');
    expect(moveDescription('', profile.names)).toContain('紫色在上');
    expect(validateCube(SOLVED, profile.names)).toEqual([]);
  });
});
describe('saved workspace compatibility', () => {
  it('restores palette and face identities together', () => {
    const palette = defaultPalette();
    palette.colors.U = '#a855f7';
    palette.names.U = '紫';
    const faces = splitFaces(SOLVED);
    expect(restoreWorkspace(JSON.stringify({ version: 2, palette, faces }), null)).toEqual({
      version: 2,
      palette,
      faces,
    });
  });
  it('migrates legacy scan data with the original palette', () => {
    expect(restoreWorkspace(null, JSON.stringify(splitFaces(SOLVED))).faces).toEqual(
      splitFaces(SOLVED),
    );
  });
  it('discards scan data with invalid palettes rather than applying unrelated defaults', () => {
    const palette = defaultPalette();
    palette.colors.U = 'broken';
    expect(
      restoreWorkspace(
        JSON.stringify({ version: 2, palette, faces: splitFaces(SOLVED) }),
        JSON.stringify(splitFaces(SOLVED)),
      ).faces,
    ).toEqual(emptyFaces());
    expect(restoreWorkspace('{broken', null).palette).toEqual(defaultPalette());
  });
});
