import { describe, expect, it, beforeAll } from 'vitest';
import Cube from 'cubejs';
import { Vector3, PerspectiveCamera } from 'three';
import {
  FACES,
  SOLVED,
  DEMO_ALGORITHM,
  validateCube,
  applyMoves,
  inverseMove,
  faceletPosition,
  moveRotation,
  captureView,
  analyzeCube,
} from '../src/lib/cube';
import reported from './fixtures/incomplete-top.json' with { type: 'json' };

describe('actionable cube diagnostics', () => {
  it('identifies the recorded DB edge and both independent failures in the reported scan', () => {
    const result = analyzeCube(reported.facelets.replaceAll('?', 'U'));
    expect(result.errors.join()).toMatch(/棱块方向/);
    expect(result.errors.join()).toMatch(/奇偶/);
    expect(result.pieces).toEqual({
      edgeFlipCount: 1,
      cornerParity: 0,
      edgeParity: 1,
      flippedEdges: [
        {
          position: 'DB',
          stickers: [
            { face: 'D', index: 7, color: 'R' },
            { face: 'B', index: 7, color: 'B' },
          ],
        },
      ],
    });
  });
  it('maps a flipped UF edge to the two adjoining facelets', () => {
    const state = [...SOLVED];
    [state[7], state[19]] = [state[19], state[7]];
    expect(analyzeCube(state.join('')).pieces?.flippedEdges).toEqual([
      {
        position: 'UF',
        stickers: [
          { face: 'U', index: 7, color: 'F' },
          { face: 'F', index: 1, color: 'U' },
        ],
      },
    ]);
  });
  it('does not attribute a parity error to flipped edges when none are recorded', () => {
    const state = [...SOLVED];
    [state[10], state[19]] = [state[19], state[10]];
    const result = analyzeCube(state.join(''));
    expect(result.errors.join()).toMatch(/奇偶/);
    expect(result.pieces?.flippedEdges).toEqual([]);
  });
  it('does not produce piece-specific clues for incomplete or malformed cubies', () => {
    expect(analyzeCube(reported.facelets).pieces).toBeUndefined();
    const invalid = [...SOLVED];
    [invalid[0], invalid[20]] = [invalid[20], invalid[0]];
    expect(analyzeCube(invalid.join('')).pieces).toBeUndefined();
  });
});

describe('3D capture matches the row order in the face editor', () => {
  for (const face of FACES)
    it(`${face}: left-to-right and top-to-bottom, including the back and bottom`, () => {
      const camera = new PerspectiveCamera(35, 1, 0.1, 100);
      const pose = captureView(face);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const screen = Array.from({ length: 9 }, (_, i) =>
        new Vector3(...faceletPosition(face, i)).project(camera),
      );
      expect(screen[4].x).toBeCloseTo(0);
      expect(screen[4].y).toBeCloseTo(0);
      for (let i = 0; i < 9; i++) {
        if (i % 3 < 2) expect(screen[i].x).toBeLessThan(screen[i + 1].x);
        if (i < 6) expect(screen[i].y).toBeGreaterThan(screen[i + 3].y);
      }
    });
});

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
