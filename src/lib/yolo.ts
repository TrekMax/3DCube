import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { decodeDetections, decodeCubeDetections, detectionsToGrid } from './vision';
import { letterbox, undoLetterbox, type Rect } from './localization';
import { FACES, type Face } from './cube';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };

export class YoloDetector {
  private constructor(
    private session: ort.InferenceSession,
    readonly size: number,
    readonly purpose: 'stickers' | 'cube',
  ) {}
  static async load(file: File, purpose: 'stickers' | 'cube' = 'stickers'): Promise<YoloDetector> {
    const session = await ort.InferenceSession.create(await file.arrayBuffer(), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    try {
      const metadata = session.inputMetadata[0];
      if (!metadata?.isTensor) throw new Error('输入必须是 RGB 图像张量。');
      const shape = metadata.shape;
      if (
        shape.length !== 4 ||
        shape[0] !== 1 ||
        shape[1] !== 3 ||
        typeof shape[2] !== 'number' ||
        shape[2] !== shape[3]
      )
        throw new Error('请导出 batch=1、dynamic=False 的正方形 NCHW 模型。');
      const detector = new YoloDetector(session, shape[2], purpose);
      // Probe output compatibility before enabling YOLO in the camera panel.
      const input = new ort.Tensor('float32', new Float32Array(3 * detector.size ** 2), [
        1,
        3,
        detector.size,
        detector.size,
      ]);
      try {
        const results = await session.run({ [session.inputNames[0]!]: input });
        try {
          const output = results[session.outputNames[0]!]!;
          (purpose === 'cube' ? decodeCubeDetections : decodeDetections)(
            output.data as Float32Array,
            output.dims,
            detector.size,
          );
        } finally {
          Object.values(results).forEach((t) => t.dispose());
        }
      } finally {
        input.dispose();
      }
      return detector;
    } catch (error) {
      await session.release();
      throw error;
    }
  }
  async detect(canvas: HTMLCanvasElement, classFaces: readonly Face[] = FACES) {
    if (this.purpose !== 'stickers') throw new Error('请加载六类色块模型用于颜色检测。');
    const detections = await this.infer(canvas, (data, dims, size) =>
      decodeDetections(data, dims, size, 0.45, classFaces),
    );
    return { detections, colors: detectionsToGrid(detections) };
  }
  async locate(canvas: HTMLCanvasElement) {
    if (this.purpose !== 'cube') throw new Error('请加载单类 cube 模型用于定位。');
    return this.infer(canvas, decodeCubeDetections);
  }
  private async infer<T extends Rect>(
    canvas: HTMLCanvasElement,
    decode: (data: ArrayLike<number>, dims: readonly number[], size: number) => T[],
  ): Promise<T[]> {
    const transform = letterbox(canvas.width, canvas.height, this.size);
    const resized = document.createElement('canvas');
    resized.width = resized.height = this.size;
    const ctx = resized.getContext('2d', { willReadFrequently: true })!;
    // Preserve camera aspect ratio, matching Ultralytics' centered LetterBox preprocessing.
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.drawImage(
      canvas,
      transform.left,
      transform.top,
      transform.resizedWidth,
      transform.resizedHeight,
    );
    const pixels = ctx.getImageData(0, 0, this.size, this.size).data;
    const area = this.size ** 2,
      data = new Float32Array(area * 3);
    for (let i = 0; i < area; i++) {
      data[i] = pixels[i * 4]! / 255;
      data[i + area] = pixels[i * 4 + 1]! / 255;
      data[i + area * 2] = pixels[i * 4 + 2]! / 255;
    }
    const tensor = new ort.Tensor('float32', data, [1, 3, this.size, this.size]);
    try {
      const result = await this.session.run({ [this.session.inputNames[0]!]: tensor });
      try {
        const output = result[this.session.outputNames[0]!]!;
        return decode(output.data as Float32Array, output.dims, this.size).map((box) =>
          undoLetterbox(box, transform),
        );
      } finally {
        Object.values(result).forEach((t) => t.dispose());
      }
    } finally {
      tensor.dispose();
    }
  }
  release() {
    return this.session.release();
  }
}
