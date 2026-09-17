// Real-weight verification against the app's WASM runtime, preprocessing, decoder and camera UI.
// Start `npm run dev`, then: node scripts/verify_rubik_yolo.mjs /path/to/rubik-yolo/val/images
import { chromium, expect } from '@playwright/test';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (!process.argv[2])
  throw new Error('Usage: node scripts/verify_rubik_yolo.mjs IMAGE_DIRECTORY [MODEL_DIRECTORY]');
const imageDirectory = path.resolve(process.argv[2]);
const modelDirectory = path.resolve(process.argv[3] || 'models');
const outputDirectory = path.resolve('test-results/rubik-yolo');
const files = (await readdir(imageDirectory)).filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();
if (!files.length) throw new Error('No test images found.');
await mkdir(outputDirectory, { recursive: true });
// Optional upstream OBB labels: compare complete grids against separately annotated colors.
async function expectedGrid(imageName, region) {
  const label = path.join(
    path.dirname(imageDirectory),
    'labels',
    path.parse(imageName).name + '.txt',
  );
  let contents;
  try {
    contents = await readFile(label, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const boxes = contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [classId, ...corners] = line.trim().split(/\s+/).map(Number);
      if (corners.length !== 8 || !corners.every(Number.isFinite))
        throw new Error(`Invalid OBB label: ${label}`);
      const xs = corners.filter((_, i) => i % 2 === 0),
        ys = corners.filter((_, i) => i % 2 === 1);
      return {
        classId,
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        cx: xs.reduce((a, b) => a + b) / 4,
        cy: ys.reduce((a, b) => a + b) / 4,
      };
    });
  const faces = boxes.filter((box) => box.classId === 6);
  const distance = (box) =>
    (box.cx - region.x - region.width / 2) ** 2 + (box.cy - region.y - region.height / 2) ** 2;
  const face = faces.sort((a, b) => distance(a) - distance(b))[0];
  if (!face || face.width <= 0 || face.height <= 0) return null;
  const grid = Array(9).fill('?');
  for (const box of boxes.filter((box) => box.classId < 6)) {
    const c = Math.floor(((box.cx - face.x) / face.width) * 3),
      r = Math.floor(((box.cy - face.y) / face.height) * 3);
    if (c < 0 || c >= 3 || r < 0 || r >= 3) continue;
    if (grid[r * 3 + c] !== '?') return null; // Ambiguous tilted/multiple-face annotations.
    grid[r * 3 + c] = 'BFLRUD'[box.classId];
  }
  return grid.includes('?') ? null : grid.join('');
}
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const assets = new Map([
    ...['locator', 'stickers'].map((purpose) => [
      `/__rubik-yolo/${purpose}.onnx`,
      path.join(modelDirectory, `rubik-yolo-${purpose}.onnx`),
    ]),
    ...files.map((name, i) => [`/__rubik-yolo/image-${i}`, path.join(imageDirectory, name)]),
  ]);
  await page.route('**/__rubik-yolo/*', (route) => {
    const asset = assets.get(new URL(route.request().url()).pathname);
    return asset ? route.fulfill({ path: asset }) : route.abort();
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/');
  const results = await page.evaluate(async (files) => {
    const { YoloDetector } = await import('/src/lib/yolo.ts');
    const { chooseCube, regionProblem } = await import('/src/lib/localization.ts');
    const load = async (purpose) =>
      YoloDetector.load(
        new File(
          [await (await fetch(`/__rubik-yolo/${purpose}.onnx`)).arrayBuffer()],
          `${purpose}.onnx`,
        ),
        purpose === 'locator' ? 'cube' : 'stickers',
      );
    const locator = await load('locator'),
      detector = await load('stickers');
    const results = [];
    try {
      for (const [i, name] of files.entries()) {
        const image = new Image();
        image.src = `/__rubik-yolo/image-${i}`;
        await image.decode();
        const frame = document.createElement('canvas');
        const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
        frame.width = Math.round(image.width * scale);
        frame.height = Math.round(image.height * scale);
        const context = frame.getContext('2d');
        context.drawImage(image, 0, 0, frame.width, frame.height);
        const start = performance.now();
        const boxes = await locator.locate(frame),
          selected = chooseCube(boxes, null);
        const entry = {
          image: name,
          imageIndex: i,
          frameSize: [frame.width, frame.height],
          faceDetections: boxes.length,
          selectedFace: selected,
          regionProblem: selected
            ? regionProblem(selected, frame.width, frame.height)
            : 'No face detected',
        };
        if (selected && !entry.regionProblem) {
          const crop = document.createElement('canvas');
          crop.width = crop.height = 320;
          const ctx = crop.getContext('2d');
          ctx.drawImage(
            frame,
            selected.x * frame.width,
            selected.y * frame.height,
            selected.width * frame.width,
            selected.height * frame.height,
            0,
            0,
            320,
            320,
          );
          const result = await detector.detect(frame, undefined, selected);
          entry.grid = result.colors.join('');
          entry.stickerDetections = result.detections.length;
          entry.complete = !entry.grid.includes('?');
          entry.confidences = result.detections.map((box) => Number(box.score.toFixed(3)));
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#00ff88';
          ctx.fillStyle = '#001a14';
          ctx.font = 'bold 16px sans-serif';
          for (const box of result.detections) {
            ctx.strokeRect(box.x * 320, box.y * 320, box.width * 320, box.height * 320);
            ctx.fillText(box.color, box.x * 320 + 4, box.y * 320 + 18);
          }
          entry.preview = crop.toDataURL('image/png');
        }
        entry.inferenceMs = Math.round(performance.now() - start);
        results.push(entry);
      }
    } finally {
      await detector.release();
      await locator.release();
    }
    return results;
  }, files);
  for (const entry of results) {
    if (entry.selectedFace) {
      entry.expectedGrid = await expectedGrid(entry.image, entry.selectedFace);
      entry.matchesLabels = entry.expectedGrid ? entry.grid === entry.expectedGrid : null;
    }
    if (entry.preview) {
      await writeFile(
        path.join(outputDirectory, `${entry.image}.png`),
        Buffer.from(entry.preview.split(',')[1], 'base64'),
      );
      delete entry.preview;
    }
    console.log(JSON.stringify(entry));
  }
  const sample = results.find((entry) => entry.complete);
  let captured = false;
  if (sample) {
    // Exercise the actual camera controls and capture button with one real image as video input.
    await page.evaluate(async (index) => {
      const image = new Image();
      image.src = `/__rubik-yolo/image-${index}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      const scale = 1280 / Math.max(image.width, image.height);
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const draw = () =>
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      draw();
      setInterval(draw, 100);
      navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
    }, sample.imageIndex);
    await page
      .getByLabel('魔方定位 ONNX 模型')
      .setInputFiles(path.join(modelDirectory, 'rubik-yolo-locator.onnx'));
    await expect(page.locator('.locator-line')).toContainText('rubik-yolo-locator.onnx', {
      timeout: 60000,
    });
    await page
      .getByLabel('色块识别 ONNX 模型')
      .setInputFiles(path.join(modelDirectory, 'rubik-yolo-stickers.onnx'));
    await expect(page.locator('.model-line:not(.locator-line)')).toContainText(
      'rubik-yolo-stickers.onnx',
      { timeout: 60000 },
    );
    const names = {
      U: ['白', '顶面'],
      R: ['红', '右面'],
      F: ['绿', '前面'],
      D: ['黄', '底面'],
      L: ['橙', '左面'],
      B: ['蓝', '后面'],
    };
    const [color, face] = names[sample.grid[4]];
    await page.getByRole('button', { name: `选择${color}色中心${face}`, exact: true }).click();
    await page.getByRole('button', { name: '开启摄像头', exact: true }).click();
    await expect(page.locator('.tracked-cube')).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: '采集此面', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await page.getByRole('button', { name: '采集此面', exact: true }).click();
    await expect(page.locator('.face-card.recorded')).toHaveCount(1);
    const recorded = await page.evaluate(
      (face) => JSON.parse(localStorage.getItem('cube-guide-workspace-v2')).faces[face].join(''),
      sample.grid[4],
    );
    expect(recorded).toBe(sample.grid);
    await page.screenshot({
      path: path.join(outputDirectory, 'browser-capture.png'),
      fullPage: true,
    });
    captured = true;
  }
  const labeled = results.filter((entry) => entry.complete && entry.expectedGrid);
  const disagreements = labeled.flatMap((entry) =>
    [...entry.grid].flatMap((color, i) =>
      color === entry.expectedGrid[i]
        ? []
        : [{ image: entry.image, cell: i + 1, detected: color, annotated: entry.expectedGrid[i] }],
    ),
  );
  const report = {
    note: 'Integration smoke check on supplied sample images; complete grid does not establish color accuracy or generalization.',
    images: results,
    labelComparison: { checkedCells: labeled.length * 9, disagreements },
    browserCapture: captured,
    pageErrors: errors,
  };
  await writeFile(
    path.join(outputDirectory, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  expect(errors).toEqual([]);
  // This checks integration, not model accuracy. Report disagreement for visual review:
  // upstream labels can also be wrong; never silently rewrite predictions or annotations.
  if (disagreements.length)
    console.warn('Review prediction/annotation differences:', disagreements);
  if (!captured)
    throw new Error(
      'No complete frontal grid found. Inspect report.json; camera capture was not verified.',
    );
  console.log(
    `Verified real-weight browser capture. Report: ${path.join(outputDirectory, 'report.json')}`,
  );
} finally {
  await browser.close();
}
