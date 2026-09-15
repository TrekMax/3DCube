import { test, expect } from '@playwright/test';
import path from 'node:path';

test.use({
  launchOptions: {
    args: [
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});
test('loads a real ONNX graph, runs inference and records nine detected stickers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByLabel('色块识别 ONNX 模型')
    .setInputFiles(path.resolve('tests/fixtures/constant-white-test.onnx'));
  await expect(page.locator('.model-line:not(.locator-line)')).toContainText(
    'YOLO · constant-white-test.onnx',
    {
      timeout: 45000,
    },
  );
  await page.getByRole('button', { name: '开启摄像头' }).click();
  await expect(page.getByRole('button', { name: '采集此面' })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('.detection-box')).toHaveCount(9);
  await page.getByRole('button', { name: '采集此面' }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(1);
  await expect(page.locator('.scan-instruction')).toContainText('红色中心');
  await expect(page.getByRole('button', { name: '采集此面' })).toBeDisabled();
  await page.getByRole('button', { name: '关闭摄像头' }).click();
  await expect(page.getByRole('button', { name: '开启摄像头' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('automatically follows an off-center cube and clears the target when it disappears', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const fixture = window as unknown as { cubeTestBrightness: number };
    fixture.cubeTestBrightness = 128;
    const draw = () => {
      const ctx = canvas.getContext('2d')!;
      const value = fixture.cubeTestBrightness;
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(0, 0, 640, 480);
    };
    draw();
    setInterval(draw, 50);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
  });
  await page.goto('/');
  await page
    .getByLabel('魔方定位 ONNX 模型')
    .setInputFiles(path.resolve('tests/fixtures/input-driven-cube-test.onnx'));
  await expect(page.locator('.locator-line')).toContainText(
    '自动定位 · input-driven-cube-test.onnx',
  );
  await page.getByRole('button', { name: '开启摄像头' }).click();
  await expect(page.locator('.tracked-cube')).toBeVisible();
  await expect(page.getByRole('button', { name: '采集此面' })).toBeEnabled();
  const first = (await page.locator('.tracked-cube').boundingBox())!;
  await expect(page.locator('.camera-viewport .scan-guide')).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { cubeTestBrightness: number }).cubeTestBrightness = 255;
  });
  await expect
    .poll(async () => (await page.locator('.tracked-cube').boundingBox())?.x ?? 0)
    .toBeGreaterThan(first.x + 35);
  await expect(page.getByRole('button', { name: '采集此面' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/auto-position.png', fullPage: true });
  await page.getByRole('button', { name: '采集此面' }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(1);
  await page.evaluate(() => {
    (window as unknown as { cubeTestBrightness: number }).cubeTestBrightness = 0;
  });
  await expect(page.locator('.tracking-status')).toContainText('未检测到魔方');
  await expect(page.locator('.tracked-cube')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '采集此面' })).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { cubeTestBrightness: number }).cubeTestBrightness = 128;
  });
  await expect(page.locator('.tracked-cube')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await page.locator('.tracked-cube').boundingBox())?.width ?? 0)
    .toBeLessThan(first.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '停用定位模型' }).click();
  await expect(page.locator('.camera-viewport .scan-guide')).toBeVisible();
  await expect(page.locator('.tracked-cube')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rejects a color model loaded as a locator without disabling the color model', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('色块识别 ONNX 模型')
    .setInputFiles(path.resolve('tests/fixtures/constant-white-test.onnx'));
  await expect(page.locator('.model-line:not(.locator-line)')).toContainText('YOLO ·');
  await page
    .getByLabel('魔方定位 ONNX 模型')
    .setInputFiles(path.resolve('tests/fixtures/constant-white-test.onnx'));
  await expect(page.getByRole('alert')).toContainText('单类 cube');
  await expect(page.locator('.locator-line')).toContainText('未加载模型');
  await expect(page.locator('.model-line:not(.locator-line)')).toContainText(
    'YOLO · constant-white-test.onnx',
  );
});
