import { test, expect } from '@playwright/test';
import path from 'node:path';

test('custom colors update the UI and 3D, persist and accompany exported solutions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('.cube-scene canvas');
  await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByLabel('U 面颜色名称').fill('紫色');
  await page.getByLabel('U 面 HEX 色值').fill('#A855F7');
  await page.getByLabel('D 面颜色名称').fill('粉');
  await page.getByLabel('D 面 HEX 色值').fill('#f472b6');
  await page.screenshot({ path: 'test-results/custom-palette.png', fullPage: true });
  await page.getByRole('button', { name: '保存配色', exact: true }).click();
  await expect(page.locator('.scan-instruction')).toContainText('紫色中心');
  await expect(
    page.getByRole('button', { name: '选择紫色中心顶面' }).locator('.face-grid>span').nth(4),
  ).toHaveCSS('background-color', 'rgb(168, 85, 247)');
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.screenshot({ path: 'test-results/custom-cube.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.scan-instruction')).toContainText('紫色中心');
  await page.getByRole('button', { name: '手动录入颜色' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '使用粉色' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '体验演示魔方' }).click();
  await page.getByRole('button', { name: '生成复原步骤' }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled({
    timeout: 45000,
  });
  await expect(page.locator('.capture-progress')).toContainText('紫色朝上');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const stream = await (await pending).createReadStream();
  const buffers = [];
  for await (const chunk of stream!) buffers.push(chunk);
  const exported = JSON.parse(Buffer.concat(buffers).toString());
  expect(exported.palette.colors.U).toBe('#a855f7');
  expect(exported.palette.names.U).toBe('紫');
  expect(exported.solution.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('validation, cancel, rename-only retention, reset and mobile settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '体验演示魔方' }).click();
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByLabel('U 面 HEX 色值').fill('#e65253');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('太接近');
  await expect(page.getByRole('button', { name: '应用并重新扫描' })).toBeDisabled();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(6);
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByLabel('U 面颜色名称').fill('米白');
  await page.getByRole('button', { name: '保存配色', exact: true }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(6);
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByLabel('U 面颜色名称').fill('紫');
  await page.getByLabel('U 面 HEX 色值').fill('#a855f7');
  await expect(
    page.getByText('颜色或类别映射已改变。应用后将清空已采集的六面和解法，请重新扫描。'),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/custom-palette-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '应用并重新扫描' }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(0);
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认配色' }).click();
  await page.getByRole('button', { name: '保存配色', exact: true }).click();
  await expect(page.locator('.scan-instruction')).toContainText('白色中心');
});

test('camera sampling recognizes a custom purple sticker and YOLO follows custom class mapping', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const draw = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#a855f7';
      ctx.fillRect(0, 0, 640, 480);
    };
    draw();
    setInterval(draw, 50);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
  });
  await page.goto('/');
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByLabel('U 面颜色名称').fill('紫');
  await page.getByLabel('U 面 HEX 色值').fill('#a855f7');
  await page.getByRole('button', { name: '保存配色', exact: true }).click();
  await page.getByRole('button', { name: '开启摄像头' }).click();
  await expect(page.getByRole('button', { name: '采集此面' })).toBeEnabled();
  await page.getByRole('button', { name: '采集此面' }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(1);
  await page.getByRole('button', { name: '自定义配色', exact: true }).click();
  await page.getByText('YOLO 类别映射（使用色块模型时）', { exact: true }).click();
  await page.getByLabel('YOLO 类别 0 对应面').selectOption('R');
  await expect(page.getByRole('alert')).toContainText('一一对应');
  await page.getByLabel('YOLO 类别 1 对应面').selectOption('U');
  await page.getByRole('button', { name: '应用并重新扫描' }).click();
  await page
    .getByLabel('色块识别 ONNX 模型')
    .setInputFiles(path.resolve('tests/fixtures/constant-white-test.onnx'));
  await expect(page.locator('.live-result')).toContainText('请转到指定中心色');
  await expect(page.getByRole('button', { name: '采集此面' })).toBeDisabled();
  await page.getByRole('button', { name: '选择红色中心右面' }).click();
  await expect(page.getByRole('button', { name: '采集此面' })).toBeEnabled();
  await page.getByRole('button', { name: '采集此面' }).click();
  await expect(page.getByRole('button', { name: '选择红色中心右面' })).toContainText('已采集');
});
