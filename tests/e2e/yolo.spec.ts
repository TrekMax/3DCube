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
    .locator('input[type=file]')
    .setInputFiles(path.resolve('tests/fixtures/constant-white-test.onnx'));
  await expect(page.locator('.model-line')).toContainText('YOLO · constant-white-test.onnx', {
    timeout: 45000,
  });
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
