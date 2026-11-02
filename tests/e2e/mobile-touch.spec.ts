import { expect, test, type Page } from '@playwright/test';
import { createBatchPdf, waitForRuntimeReady } from './helpers/fixtures';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8, id: 1
      }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    // Playwright exposes touch taps, but no WebKit touch-drag transport.
    // Exercise the Pointer Events path while taps still use the real touchscreen API.
    await page.evaluate(({ from, to }) => {
      const target = document.elementFromPoint(from.x, from.y);
      if (!target) throw new Error('Missing gesture target');
      const emit = (type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 21, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1
      }));
      emit('pointerdown', from.x, from.y);
      for (let step = 1; step <= 8; step += 1) emit('pointermove', from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8);
      emit('pointerup', to.x, to.y);
    }, { from, to });
  }
}

test('touch draw, place, move, resize, edit, navigate and download', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'touch-contract.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Touch signing', 2)
  });
  await page.getByLabel('Create signature').tap();
  await page.getByRole('button', { name: 'Draw', exact: true }).tap();
  const pad = page.getByRole('dialog');
  const canvas = pad.locator('canvas');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Missing drawing canvas');
  const from = { x: bounds.x + bounds.width * 0.15, y: bounds.y + bounds.height * 0.5 };
  await touchDrag(page, from, { x: from.x + bounds.width * 0.65, y: from.y + 12 });
  await expect(pad.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await pad.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(pad).toBeHidden();
  await page.getByRole('button', { name: 'More actions for touch-contract.pdf' }).tap();
  await page.getByRole('button', { name: 'Sign', exact: true }).tap();
  const layer = page.getByTestId('placement-layer').first();
  await layer.scrollIntoViewIfNeeded();
  const box = await layer.boundingBox();
  if (!box) throw new Error('Missing PDF page');
  const scroll = page.getByTestId('editor-scroll');
  expect(await scroll.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(2);
  await page.touchscreen.tap(box.x + box.width * 0.4, box.y + Math.min(120, box.height * 0.25));
  const signature = layer.getByRole('button', { name: 'Signature', exact: true });
  await expect(signature).toBeVisible();
  await signature.tap();
  const before = await signature.boundingBox();
  if (!before) throw new Error('Missing signature');
  await touchDrag(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 }, { x: before.x + before.width / 2 + 25, y: before.y + before.height / 2 + 35 });
  const moved = await signature.boundingBox();
  expect(moved?.x).toBeGreaterThan(before.x + 15);
  const handle = layer.getByRole('button', { name: 'Resize se' });
  const resize = await handle.boundingBox();
  if (!resize) throw new Error('Missing resize handle');
  await touchDrag(page, { x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 }, { x: resize.x + resize.width / 2 + 20, y: resize.y + resize.height / 2 + 10 });
  expect((await signature.boundingBox())?.width).toBeGreaterThan(before.width + 10);
  await noOverflow(page);

  await page.getByRole('button', { name: 'Show library', exact: true }).tap();
  const library = page.getByRole('dialog');
  await library.getByRole('button', { name: 'Text', exact: true }).tap();
  await expect(library).toBeHidden();
  await page.getByRole('toolbar', { name: 'Selected element' }).getByRole('button', { name: 'Edit', exact: true }).tap();
  const input = page.getByRole('textbox', { name: 'Element text' });
  await input.fill('Signed on my phone');
  await input.press('Enter');
  await expect(page.getByText('Signed on my phone', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Show pages', exact: true }).tap();
  await page.getByRole('dialog').getByRole('button', { name: /Page 2/ }).tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).tap();
  expect((await downloadPromise).suggestedFilename()).toBe('touch-contract-signed.pdf');
  await noOverflow(page);
});

test('drawing actions remain reachable in short landscape windows', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'landscape.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Landscape', 1) });
  await page.getByLabel('Create signature').tap();
  await page.getByRole('button', { name: 'Draw', exact: true }).tap();
  const dialog = page.getByRole('dialog');
  const canvas = dialog.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing drawing canvas');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.tap();
  await expect(dialog).toBeHidden();
  await noOverflow(page);
});
