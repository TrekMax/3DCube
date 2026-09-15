import { describe, expect, it } from 'vitest';
import {
  chooseCube,
  intersectionOverUnion,
  letterbox,
  projectToViewport,
  regionProblem,
  undoLetterbox,
  type CubeDetection,
} from '../src/lib/localization';
import { decodeCubeDetections } from '../src/lib/vision';

describe('full-camera coordinates', () => {
  it('undoes horizontal video letterboxing and projects into a contained preview', () => {
    const transform = letterbox(1280, 720, 320);
    expect(transform.top).toBe(70);
    const box = undoLetterbox(
      { x: 40 / 320, y: 100 / 320, width: 80 / 320, height: 80 / 320 },
      transform,
    );
    expect(box.x).toBeCloseTo(0.125);
    expect(box.y).toBeCloseTo(1 / 6);
    const screen = projectToViewport(box, 1280, 720, 480, 300);
    expect(screen.x).toBeCloseTo(60);
    expect(screen.y).toBeCloseTo(60);
    expect(screen.width).toBeCloseTo(120);
    expect(screen.height).toBeCloseTo(120);
  });
  it('handles portrait frames and resized mobile viewports', () => {
    const transform = letterbox(480, 640, 320);
    expect(transform.left).toBe(40);
    const box = undoLetterbox({ x: 0.25, y: 0.25, width: 0.25, height: 0.25 }, transform);
    expect(box.x).toBeCloseTo(1 / 6);
    expect(box.width).toBeCloseTo(1 / 3);
    const screen = projectToViewport(box, 480, 640, 360, 320);
    expect(screen).toEqual({ x: 100, y: 80, width: 80, height: 80 });
  });
  it('preserves out-of-frame coordinates so partial cubes are not accepted', () => {
    const box = undoLetterbox(
      { x: 0.2, y: 0.1, width: 0.3, height: 0.3 },
      letterbox(1280, 720, 320),
    );
    expect(box.y).toBeLessThan(0);
    expect(regionProblem(box, 1280, 720)).toMatch(/完整入镜/);
  });
});
describe('cube selection and capture eligibility', () => {
  const left: CubeDetection = { x: 0.02, y: 0.3, width: 0.2, height: 0.3, score: 0.8 };
  const right: CubeDetection = { x: 0.7, y: 0.3, width: 0.2, height: 0.3, score: 0.95 };
  it('finds off-center cubes and keeps the previous target among several cubes', () => {
    expect(chooseCube([left, right], null)).toEqual(right);
    expect(chooseCube([left, right], left)).toEqual(left);
    expect(chooseCube([left], right)).toEqual(left);
  });
  it('does not keep stale detections when the target disappears', () => {
    expect(chooseCube([], left)).toBeNull();
    expect(chooseCube([{ ...left, x: -2 }], null)).toBeNull();
  });
  it('detects large motion while allowing small detector jitter', () => {
    expect(intersectionOverUnion(left, { ...left, x: left.x + 0.005 })).toBeGreaterThan(0.8);
    expect(intersectionOverUnion(left, right)).toBe(0);
  });
  it('rejects tiny, partial and elongated regions but accepts a frontal face', () => {
    expect(regionProblem({ x: 0.1, y: 0.2, width: 0.2, height: 0.2 }, 640, 640)).toBe('');
    expect(regionProblem({ x: 0.1, y: 0.2, width: 0.05, height: 0.05 }, 640, 640)).toMatch(/靠近/);
    expect(regionProblem({ x: 0.9, y: 0.2, width: 0.2, height: 0.2 }, 640, 640)).toMatch(/完整/);
    expect(regionProblem({ x: 0.1, y: 0.2, width: 0.5, height: 0.2 }, 640, 640)).toMatch(/正对/);
  });
});
describe('single-class Ultralytics cube model', () => {
  it('decodes channel-major cube predictions and removes duplicate boxes', () => {
    const result = decodeCubeDetections(
      [80, 81, 160, 160, 80, 80, 80, 80, 0.9, 0.8],
      [1, 5, 2],
      320,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ x: 0.125, y: 0.375, width: 0.25, height: 0.25, score: 0.9 });
  });
  it('supports row-major and post-NMS predictions', () => {
    expect(decodeCubeDetections([80, 160, 80, 80, 0.9], [1, 1, 5], 320)).toHaveLength(1);
    expect(decodeCubeDetections([40, 120, 120, 200, 0.9, 0], [1, 1, 6], 320)[0]?.width).toBe(0.25);
  });
  it('filters low confidence and non-cube class IDs', () => {
    expect(decodeCubeDetections([80, 160, 80, 80, 0.3], [1, 1, 5], 320)).toEqual([]);
    expect(decodeCubeDetections([40, 120, 120, 200, 0.9, 1], [1, 1, 6], 320)).toEqual([]);
  });
  it('rejects incompatible models and malformed tensors', () => {
    expect(() => decodeCubeDetections([], [1, 84, 8400], 320)).toThrow(/单类/);
    expect(() => decodeCubeDetections([], [1, 5, 8400], 320)).toThrow(/长度/);
  });
});
