import { test, expect } from '@playwright/test';

test('demo, solver worker, forward/backward, completion and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '把每一步，转对。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成复原步骤' })).toBeDisabled();
  await expect(page.locator('.cube-scene canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '体验演示魔方' }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(6);
  await page.getByRole('button', { name: '生成复原步骤' }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled({
    timeout: 45000,
  });
  await expect(page.locator('.current-move')).not.toBeEmpty();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.locator('.step-counter')).toContainText('1 /');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.locator('.step-counter')).toContainText('0 /');
  await page.getByLabel('动画速度').selectOption('2');
  await page.getByRole('button', { name: '自动播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible();
  await expect(page.locator('.step-counter')).not.toContainText('0 /');
  await page.getByRole('button', { name: '暂停播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/solution.png', fullPage: true });
  await page.getByRole('button', { name: '跳到最后一步' }).click();
  await expect(page.getByText('六面归位，做得漂亮。')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('cube-guide.json');
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('manual entry, persistence, color validation and help', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '手动录入颜色' }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('button', { name: '第 5 格：白色，中心固定' })).toBeDisabled();
  await editor.getByRole('button', { name: '填满白色' }).click();
  await editor.getByRole('button', { name: '保存此面' }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.face-card.recorded')).toHaveCount(1);
  await page.getByRole('button', { name: '体验演示魔方' }).click();
  await page.getByRole('button', { name: '手动校正颜色' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '填满白色' }).click();
  await page.getByRole('button', { name: '保存此面' }).click();
  await page.getByRole('button', { name: '生成复原步骤' }).click();
  await expect(page.getByRole('alert')).toContainText('应为 9');
  await page.getByRole('button', { name: '打开使用帮助' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ultralytics YOLO');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('camera failure and invalid ONNX model are explained', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开启摄像头' }).click();
  await expect(page.getByRole('alert')).toContainText(/摄像头|设备/);
  await page.getByLabel('色块识别 ONNX 模型').setInputFiles({
    name: 'bad.onnx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not an onnx model'),
  });
  await expect(page.getByRole('alert')).toContainText('模型加载失败', { timeout: 45000 });
});

test('mobile layout and editor fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.cube-scene canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: '手动录入颜色' }).click();
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
