import { describe, expect, it } from 'vitest';
import {
  classifyColor,
  decodeDetections,
  detectionsToGrid,
  detectionsInRegion,
  type Detection,
} from '../src/lib/vision';

describe('camera colors', () => {
  it('classifies reference stickers and rejects darkness', () => {
    expect(classifyColor(245, 245, 239)).toBe('U');
    expect(classifyColor(220, 40, 45)).toBe('R');
    expect(classifyColor(20, 160, 70)).toBe('F');
    expect(classifyColor(240, 215, 20)).toBe('D');
    expect(classifyColor(240, 110, 10)).toBe('L');
    expect(classifyColor(35, 90, 220)).toBe('B');
    expect(classifyColor(5, 5, 5)).toBe('?');
  });
});
describe('Ultralytics detections', () => {
  it('decodes channel-major raw YOLO output and suppresses duplicate classes', () => {
    const data = new Float32Array(30);
    const detections = [
      [50, 50, 40, 40, 0.9, 0, 0, 0, 0, 0],
      [51, 50, 40, 40, 0, 0.8, 0, 0, 0, 0],
      [150, 50, 40, 40, 0, 0, 0.95, 0, 0, 0],
    ];
    detections.forEach((row, i) => row.forEach((value, c) => (data[c * 3 + i] = value)));
    const result = decodeDetections(data, [1, 10, 3], 300);
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.color)).toEqual(['F', 'U']);
    expect(detectionsToGrid(result).slice(0, 3)).toEqual(['U', 'F', '?']);
  });
  it('decodes row-major raw output and post-NMS xyxy output', () => {
    expect(decodeDetections([50, 50, 40, 40, 0, 0, 0, 0, 0.8, 0], [1, 1, 10], 300)[0]?.color).toBe(
      'L',
    );
    const boxes = decodeDetections([10, 10, 90, 90, 0.8, 5], [1, 1, 6], 300);
    expect(boxes[0]?.color).toBe('B');
    expect(boxes[0]?.width).toBeCloseTo(80 / 300);
  });
  it('rejects generic COCO models and malformed output', () => {
    expect(() => decodeDetections([], [1, 84, 8400], 640)).toThrow(/六种/);
    expect(() => decodeDetections([], [10, 10], 320)).toThrow();
  });
  it('leaves unknown cells for missing, oversized or off-grid boxes', () => {
    const boxes: Detection[] = [
      { x: 0, y: 0, width: 1, height: 1, score: 0.99, color: 'U' },
      { x: -0.5, y: 0, width: 0.1, height: 0.1, score: 0.99, color: 'R' },
    ];
    expect(detectionsToGrid(boxes)).toEqual(Array(9).fill('?'));
  });
  it('projects full-frame stickers into an off-center face and excludes neighboring faces', () => {
    const region = { x: 0.5, y: 0.2, width: 0.3, height: 0.6 };
    const boxes: Detection[] = Array.from({ length: 9 }, (_, i) => ({
      x: region.x + (((i % 3) + 0.2) / 3) * region.width,
      y: region.y + ((Math.floor(i / 3) + 0.2) / 3) * region.height,
      width: region.width * 0.2,
      height: region.height * 0.2,
      score: 0.9,
      color: i === 4 ? 'R' : 'U',
    }));
    boxes.push({ x: 0, y: 0.2, width: 0.1, height: 0.1, score: 1, color: 'B' });
    const selected = detectionsInRegion(boxes, region);
    expect(selected).toHaveLength(9);
    expect(selected[0]!.x).toBeCloseTo(0.2 / 3);
    expect(selected[0]!.width).toBeCloseTo(0.2);
    expect(selected[0]!.height).toBeCloseTo(0.2);
    expect(detectionsToGrid(selected).join('')).toBe('UUUURUUUU');
    expect(detectionsToGrid(detectionsInRegion(boxes.slice(1), region))[0]).toBe('?');
    expect(boxes[0]!.x).toBeGreaterThan(region.x);
  });
  it('rejects degenerate full-frame regions', () => {
    for (const width of [0, -1, NaN]) {
      expect(() => detectionsInRegion([], { x: 0, y: 0, width, height: 1 })).toThrow(/区域/);
    }
  });
});
