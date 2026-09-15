import { describe, expect, it, beforeAll } from 'vitest';
import Cube from 'cubejs';
import { Vector3 } from 'three';
import {
  FACES,
  SOLVED,
  DEMO_ALGORITHM,
  validateCube,
  applyMoves,
  inverseMove,
  faceletPosition,
  moveRotation,
} from '../src/lib/cube';

describe('physical cube validation', () => {
  it('accepts solved and scrambled states', () => {
    expect(validateCube(SOLVED)).toEqual([]);
    expect(validateCube(applyMoves(SOLVED, DEMO_ALGORITHM))).toEqual([]);
    for (let i = 0; i < 20; i++) expect(validateCube(Cube.random().asString())).toEqual([]);
  });
  it('rejects missing stickers and wrong color counts', () => {
    expect(validateCube(SOLVED.replace('U', '?'))[0]).toMatch(/未录入/);
    expect(validateCube(SOLVED.replace('U', 'R')).join()).toMatch(/应为 9/);
  });
  it('rejects a single flipped edge even when all colors count to nine', () => {
    const state = SOLVED.split('');
    [state[7], state[19]] = [state[19], state[7]];
    expect(validateCube(state.join('')).join()).toMatch(/棱块方向/);
  });
  it('rejects a twisted corner', () => {
    const state = SOLVED.split('');
    [state[8], state[9], state[20]] = [state[9], state[20], state[8]];
    expect(validateCube(state.join('')).join()).toMatch(/角块方向/);
  });
  it('rejects two swapped edge pieces', () => {
    const state = SOLVED.split('');
    [state[10], state[19]] = [state[19], state[10]];
    expect(validateCube(state.join('')).join()).toMatch(/奇偶/);
  });
  it('rejects impossible cubie color combinations', () => {
    const state = SOLVED.split('');
    [state[0], state[20]] = [state[20], state[0]];
    expect(validateCube(state.join('')).length).toBeGreaterThan(0);
  });
});

describe('3D rotation agrees with the solver coordinate system', () => {
  const normals = {
    U: [0, 1, 0],
    R: [1, 0, 0],
    F: [0, 0, 1],
    D: [0, -1, 0],
    L: [-1, 0, 0],
    B: [0, 0, -1],
  };
  for (const face of FACES)
    for (const suffix of ['', "'", '2']) {
      const move = face + suffix;
      it(move, () => {
        const before = applyMoves(SOLVED, DEMO_ALGORITHM),
          after = Array<string>(54);
        const { axis, layer, angle } = moveRotation(move);
        const rotationAxis = new Vector3();
        rotationAxis[axis] = 1;
        FACES.forEach((f, faceIndex) => {
          for (let i = 0; i < 9; i++) {
            const position = new Vector3(...faceletPosition(f, i)),
              normal = new Vector3(...normals[f]);
            if (position[axis] === layer) {
              position.applyAxisAngle(rotationAxis, angle).round();
              normal.applyAxisAngle(rotationAxis, angle).round();
            }
            const targetFace = FACES.find((t) => new Vector3(...normals[t]).equals(normal))!;
            const targetIndex = Array.from({ length: 9 }, (_, j) => j).find((j) =>
              new Vector3(...faceletPosition(targetFace, j)).equals(position),
            )!;
            after[FACES.indexOf(targetFace) * 9 + targetIndex] = before[faceIndex * 9 + i]!;
          }
        });
        expect(after.join('')).toBe(applyMoves(before, move));
        expect(applyMoves(applyMoves(before, move), inverseMove(move))).toBe(before);
      });
    }
});

describe('solver', () => {
  beforeAll(() => {
    Cube.initSolver();
  }, 30000);
  it('restores the demo and multiple random legal scrambles', () => {
    const cubes = [
      Cube.fromString(applyMoves(SOLVED, DEMO_ALGORITHM)),
      ...Array.from({ length: 4 }, () => Cube.random()),
    ];
    for (const cube of cubes) {
      const algorithm = cube.solve();
      expect(cube.move(algorithm).isSolved()).toBe(true);
    }
  }, 30000);
});
