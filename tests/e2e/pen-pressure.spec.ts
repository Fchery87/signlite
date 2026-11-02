import { expect, test } from '@playwright/test';
import { createBatchPdf, waitForRuntimeReady } from './helpers/fixtures';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
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
});
