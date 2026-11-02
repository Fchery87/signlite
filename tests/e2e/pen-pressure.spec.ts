import { expect, test } from '@playwright/test';
import { createBatchPdf, waitForRuntimeReady } from './helpers/fixtures';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});

test('cancelled touch strokes can be undone and cleared without saving an empty asset', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch cancellation is Chromium-only');
  test.setTimeout(90000);
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'cancel.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Cancel', 1) });
  await page.getByLabel('Create signature').tap();
  await page.getByRole('button', { name: 'Draw', exact: true }).tap();
  const canvas = page.getByLabel('Signature drawing canvas');
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(() => canvas.evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected drawing canvas');
    const box = node.getBoundingClientRect();
    return Math.abs(node.width / box.width - node.height / box.height);
  })).toBeLessThan(0.05);
  const hasInk = () => canvas.evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected drawing canvas');
    const context = node.getContext('2d');
    if (!context) throw new Error('Missing raster context');
    return context.getImageData(0, 0, node.width, node.height).data.some((value, index) => index % 4 === 3 && value > 0);
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 40, y: box.y + 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 100, y: box.y + 70 }] });
  const activeRaster = await canvas.evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected drawing canvas');
    return { width: node.width, height: node.height, pixels: node.toDataURL() };
  });
  await page.setViewportSize({ width: 740, height: 360 });
  await expect.poll(() => canvas.evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected drawing canvas');
    return { width: node.width, height: node.height, pixels: node.toDataURL() };
  })).toEqual(activeRaster);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(2000);
  await expect.poll(hasInk).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect.poll(hasInk).toBe(false);
  await canvas.tap();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Clear', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect.poll(hasInk).toBe(false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('No saved signature yet.', { exact: true })).toBeVisible();
});

test('native concurrent touches cannot steal the active stroke or leave capture stuck', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP concurrent touch transport is Chromium-only');
  test.setTimeout(90000);
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'multi-touch.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Multi-touch', 1) });
  await page.getByLabel('Create signature').tap();
  await page.getByRole('button', { name: 'Draw', exact: true }).tap();
  const canvas = page.getByLabel('Signature drawing canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  const first = { id: 1, x: box.x + 30, y: box.y + box.height * 0.25 };
  const second = { id: 2, x: box.x + 30, y: box.y + box.height * 0.75 };
  const raster = () => canvas.evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected drawing canvas');
    const context = node.getContext('2d');
    if (!context) throw new Error('Missing raster context');
    const data = context.getImageData(0, 0, node.width, node.height).data;
    let upper = 0;
    let lower = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] === 0) continue;
      if (index < data.length / 2) upper += 1;
      else lower += 1;
    }
    return { upper, lower };
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first, { ...second, x: box.x + box.width - 30 }] });
    await expect.poll(async () => (await raster()).lower).toBe(0);
    const middle = { ...first, x: box.x + box.width / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle, second] });
    // CDP touchEnd lists the released contacts, not the remaining contacts.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
    const beforeContinuation = await raster();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, x: box.x + box.width - 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await raster()).upper).toBeGreaterThan(beforeContinuation.upper);
    await expect.poll(async () => (await raster()).lower).toBe(0);
  } finally {
    await cdp.detach();
  }
  // Independent taps must be separated from rapid CDP gesture injection.
  await page.waitForTimeout(2000);
  await canvas.tap({ position: { x: box.width / 2, y: box.height * 0.75 } });
  await expect.poll(async () => (await raster()).lower).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect.poll(async () => (await raster()).lower).toBe(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect.poll(raster).toEqual({ upper: 0, lower: 0 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('real CDP pen produces pressure-sensitive pixels and saves', async ({
  page,
  browserName
}) => {
  test.setTimeout(120000);
  test.skip(browserName !== 'chromium', 'CDP pen transport is Chromium-only');
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page
    .locator('input[accept="application/pdf"]')
    .setInputFiles({
      name: 'pen.pdf',
      mimeType: 'application/pdf',
      buffer: await createBatchPdf('Pen', 1)
    });
  await page.getByLabel('Create signature').tap();
  await page.getByRole('button', { name: 'Draw', exact: true }).tap();
  const canvas = page.getByLabel('Signature drawing canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  expect(box.height).toBeGreaterThan(220);
  const scale = await canvas.evaluate((node) => {
    const value = node as HTMLCanvasElement;
    const bounds = value.getBoundingClientRect();
    return [value.width / bounds.width, value.height / bounds.height];
  });
  expect(scale[0]).toBeCloseTo(scale[1], 1);
  const cdp = await page.context().newCDPSession(page);
  for (const [row, force] of [
    [0.3, 0.15],
    [0.7, 0.95]
  ]) {
    const y = box.y + box.height * row;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x + 30,
      y,
      button: 'left',
      buttons: 1,
      pointerType: 'pen',
      force
    });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: box.x + 30 + ((box.width - 60) * step) / 12,
        y,
        button: 'left',
        buttons: 1,
        pointerType: 'pen',
        force
      });
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x + box.width - 30,
      y,
      button: 'left',
      buttons: 0,
      pointerType: 'pen',
      force: 0
    });
  }
  await cdp.detach();
  const ink = await canvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let top = 0;
    let bottom = 0;
    for (let y = 0; y < canvas.height; y += 1)
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3]) {
          if (y < canvas.height / 2) top += 1;
          else bottom += 1;
        }
      }
    return { top, bottom };
  });
  expect(ink.top).toBeGreaterThan(0);
  expect(ink.bottom).toBeGreaterThan(ink.top * 1.5);
  const beforeRotation = await canvas.evaluate((node) => {
    const value = node as HTMLCanvasElement;
    return {
      width: value.width,
      height: value.height,
      pixels: value.toDataURL()
    };
  });
  await page.setViewportSize({ width: 740, height: 360 });
  await expect
    .poll(() =>
      canvas.evaluate((node) => {
        const value = node as HTMLCanvasElement;
        return {
          width: value.width,
          height: value.height,
          pixels: value.toDataURL()
        };
      })
    )
    .toEqual(beforeRotation);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  const savedDrawing = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('signlite');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows: unknown = await new Promise((resolve, reject) => {
        const request = db.transaction('signatures').objectStore('signatures').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!Array.isArray(rows)) throw new Error('Expected stored signatures');
      const row: unknown = rows[0];
      if (typeof row !== 'object' || row === null || !('strokeData' in row) || typeof row.strokeData !== 'string' ||
          !('pngBytes' in row) || !(row.pngBytes instanceof ArrayBuffer)) throw new Error('Expected persisted drawing');
      return { strokes: row.strokeData, png: Array.from(new Uint8Array(row.pngBytes)) };
    } finally { db.close(); }
  });
  const stored = await savedDrawing();
  const storedStrokes: unknown = JSON.parse(stored.strokes);
  expect(storedStrokes).toEqual([
    expect.arrayContaining([expect.objectContaining({ pressure: expect.closeTo(0.15, 2) })]),
    expect.arrayContaining([expect.objectContaining({ pressure: expect.closeTo(0.95, 2) })])
  ]);
  expect(stored.png.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.reload();
  await expect.poll(savedDrawing).toEqual(stored);
});
