import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import reported from '../fixtures/incomplete-top.json' with { type: 'json' };

async function clickVisibleFace(page: Page, normal: number[]) {
  const canvas = page.locator('.cube-scene canvas');
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(35, rect.width / rect.height, 0.1, 100);
  camera.position.set(6.2, 4.6, 7.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new Vector3(normal[0], normal[1], normal[2]).multiplyScalar(1.5).project(camera);
  await canvas.click({
    position: { x: ((point.x + 1) * rect.width) / 2, y: ((1 - point.y) * rect.height) / 2 },
  });
}

test('3D ray picking selects geometric faces; dragging and empty space preserve the selection', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  for (const [normal, name, center] of [
    [[0, 0, 1], '前面', '绿'],
    [[1, 0, 0], '右面', '红'],
    [[0, 1, 0], '顶面', '白'],
  ] as const) {
    await clickVisibleFace(page, [...normal]);
    await expect(page.locator('.capture-face-info')).toContainText(`${name} · ${center}色中心`);
    await expect(page.locator('.scan-instruction')).toContainText(`${center}色中心朝向镜头`);
  }
  const canvas = page.locator('.cube-scene canvas');
  const rect = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 6, y: 6 } });
  await expect(page.locator('.capture-face-info')).toContainText('顶面');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 90, rect.y + rect.height / 2 + 25, { steps: 10 });
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.capture-face-info')).toContainText('顶面');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.face-card.recorded')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('all six capture views, keyboard shortcuts and per-face editor keep the same orientation', async ({
  page,
}) => {
  await page.goto('/');
  for (const [face, name, color, top] of [
    ['U', '顶面', '白', '蓝'],
    ['R', '右面', '红', '白'],
    ['F', '前面', '绿', '白'],
    ['D', '底面', '黄', '绿'],
    ['L', '左面', '橙', '白'],
    ['B', '后面', '蓝', '白'],
  ]) {
    const tab = page.getByRole('button', { name: `3D 采集：${name}（${color}色）` });
    await tab.focus();
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.capture-face-info')).toContainText(`${top}色中心朝上`);
    const center = page.locator('.cube-capture .face-grid button').nth(4);
    await expect(center).toBeDisabled();
    await expect(center).toContainText(face);
    await page.getByRole('button', { name: '正对当前面', exact: true }).click();
    await page.getByRole('button', { name: '补齐此面', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(`${color}色中心 · ${name}`);
    await expect(page.locator('.editor-orientation')).toContainText(`${top}色中心朝上`);
    await page.getByRole('button', { name: `用${color}色补齐 8 个空格` }).click();
    await page.getByRole('button', { name: '保存此面', exact: true }).click();
  }
  await expect(page.locator('.face-card.recorded')).toHaveCount(6);
  await page.getByRole('button', { name: '生成复原步骤' }).click();
  await expect(page.getByText('六面归位，做得漂亮。')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.cube-capture')).toHaveCount(0);
  // A solution preview cannot enter capture mode or alter the recorded face selection.
  const selected = await page.locator('.face-card.selected').getAttribute('aria-label');
  await page.getByRole('button', { name: '重置 3D 视角' }).click();
  await clickVisibleFace(page, [0, 0, 1]);
  await expect(page.locator('.face-card.selected')).toHaveAttribute('aria-label', selected!);
});

test('reported top-face draft persists, missing-only fill preserves known stickers and still validates the cube', async ({
  page,
}) => {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('cube-guide-workspace-v2'))
      localStorage.setItem(
        'cube-guide-workspace-v2',
        JSON.stringify({
          version: 2,
          palette: data.palette,
          faces: Object.fromEntries(
            [...data.faceOrder].map((f, i) => [f, data.facelets.slice(i * 9, i * 9 + 9).split('')]),
          ),
        }),
      );
  }, reported);
  await page.goto('/');
  await expect(page.locator('.face-card.recorded')).toHaveCount(5);
  await expect(page.locator('.capture-progress')).toContainText('顶面还缺 6 格');
  await page.locator('.cube-capture .face-grid button').nth(1).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '第 2 格：未录入' }),
  ).toBeFocused();
  await expect(page.locator('.editor-completeness')).toContainText('第 2、4、6、7、8、9 格');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.locator('.toast-message')).toContainText('顶面草稿已保存，还缺 6 格');
  await page.reload();
  await expect(page.locator('.face-card.recorded')).toHaveCount(5);
  await page.getByRole('button', { name: '补齐此面', exact: true }).click();
  await page.screenshot({ path: 'test-results/capture-missing.png', fullPage: true });
  await page.getByRole('button', { name: '用白色补齐 6 个空格' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '第 1 格：绿色', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '第 3 格：绿色', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '保存此面', exact: true }).click();
  await expect(page.locator('.face-card.recorded')).toHaveCount(6);
  await page.reload();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('cube-guide-workspace-v2')!).faces.U.join(''),
    ),
  ).toBe('LULUUUUUU');
  await page.getByRole('button', { name: '生成复原步骤' }).click();
  await expect(page.getByRole('alert')).toContainText('棱块方向不合法');
  const diagnostics = page.getByRole('region', { name: '具体核对位置' });
  await expect(diagnostics).toContainText('底面 / 后面相邻棱块');
  await expect(diagnostics).toContainText('不能唯一确定');
  const stored = await page.evaluate(() => localStorage.getItem('cube-guide-workspace-v2'));
  await page.getByRole('button', { name: '核对底面第 8 格', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('深蓝色中心 · 底面');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '第 8 格：浅蓝色', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.editor-modal .review-sticker')).toHaveAttribute(
    'aria-label',
    '第 8 格：浅蓝色',
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '核对后面第 8 格', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('透明蓝色中心 · 后面');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '第 8 格：透明蓝色', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('cube-guide-workspace-v2'))).toBe(stored);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await diagnostics.screenshot({ path: 'test-results/cube-diagnostics-mobile.png' });
});

test('mobile touch selection and editor fit the viewport', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  const canvas = page.locator('.cube-scene canvas');
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(35, rect.width / rect.height, 0.1, 100);
  camera.position.set(6.2, 4.6, 7.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new Vector3(0, 0, 1.5).project(camera);
  await page.touchscreen.tap(
    rect.x + ((point.x + 1) * rect.width) / 2,
    rect.y + ((1 - point.y) * rect.height) / 2,
  );
  await expect(page.locator('.capture-face-info')).toContainText('前面');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/capture-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '补齐此面', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await context.close();
});
