import Cube from 'cubejs';
import { validateCube, type Face } from '../lib/cube';
let initialized = false;
self.onmessage = (
  event: MessageEvent<{ id: number; state: string; names?: Record<Face, string> }>,
) => {
  const { id, state, names } = event.data;
  try {
    const errors = validateCube(state, names);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!initialized) {
      self.postMessage({ id, status: 'initializing' });
      Cube.initSolver();
      initialized = true;
    }
    const cube = Cube.fromString(state);
    const algorithm = cube.isSolved() ? '' : cube.solve();
    if (!Cube.fromString(state).move(algorithm).isSolved())
      throw new Error('求解结果校验失败，请重试。');
    self.postMessage({ id, algorithm });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
