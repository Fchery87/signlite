import { expect, test } from '@playwright/test';
import { SAMPLE_UPLOAD_PNG, createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

test('completes a quiet single-doc sign flow with library inputs and keyboard download', async ({ page }) => {
  test.setTimeout(90000);
  const requests: string[] = [];
  let loaded = false;

  page.on('request', (request) => {
    const url = request.url();
    if (!loaded || !/^https?:/i.test(url)) {
      return;
    }

    const parsedUrl = new URL(url);
    const isBundledWorkerAsset =
      parsedUrl.origin === 'http://127.0.0.1:4173' && /^\/assets\/(?:pdf\.worker\.min|flatten\.worker)-/.test(parsedUrl.pathname);
    if (isBundledWorkerAsset) {
      return;
    }

    requests.push(`${request.method()} ${url}`);
  });

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);

  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });

  await expect(page.getByRole('heading', { name: 'sample.pdf' })).toBeVisible();
  const layer = page.getByTestId('placement-layer');
  await expect(layer).toBeVisible();
  await page.waitForTimeout(1000);
  requests.length = 0;
  loaded = true;

  await page.getByRole('button', { name: 'Add library item' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByPlaceholder('Type your name').fill('Signer Name');
  await expect(page.getByAltText('Typed signature preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Signer Name', { exact: true })).toBeVisible();

  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'upload-signature.png',
    mimeType: 'image/png',
    buffer: SAMPLE_UPLOAD_PNG
  });
  await expect(page.getByText('upload-signature', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add library item' }).click();
  await page.getByRole('button', { name: 'Draw' }).click();

  const canvas = page.getByRole('dialog', { name: 'Draw signature' }).locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Expected draw canvas bounds');
  }
  await page.mouse.move(box.x + 40, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 6 });
  await page.mouse.move(box.x + 240, box.y + 80, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save' }).click();

  const drawnCard = page.locator('article').filter({ has: page.getByText('Signature', { exact: true }) }).first();
  await expect(drawnCard).toBeVisible();

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const layerBox = await layer.boundingBox();
  if (!layerBox) {
    throw new Error('Expected placement layer bounds');
  }

  await drawnCard.locator('button').first().dispatchEvent('dragstart', { dataTransfer });
  await layer.dispatchEvent('dragover', { dataTransfer, clientX: layerBox.x + 160, clientY: layerBox.y + 160 });
  await layer.dispatchEvent('drop', { dataTransfer, clientX: layerBox.x + 160, clientY: layerBox.y + 160 });

  await expect(page.getByRole('status').filter({ hasText: 'Signature placed on page 1.' })).toBeVisible();
  const placedSignature = page.getByRole('main').getByRole('button', { name: 'signature' });
  await placedSignature.click();
  await expect(page.getByLabel('Resize se')).toBeVisible();

  const beforeNudge = await placedSignature.evaluate((element) => {
    const wrapper = element.parentElement as HTMLElement | null;
    if (!wrapper) {
      return null;
    }
    return { left: Number.parseFloat(wrapper.style.left), top: Number.parseFloat(wrapper.style.top) };
  });
  if (!beforeNudge) {
    throw new Error('Expected placed signature position before keyboard nudge');
  }

  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () =>
      placedSignature.evaluate((element) => {
        const wrapper = element.parentElement as HTMLElement | null;
        if (!wrapper) {
          return null;
        }
        return { left: Number.parseFloat(wrapper.style.left), top: Number.parseFloat(wrapper.style.top) };
      })
    )
    .toEqual({ left: beforeNudge.left + 1, top: beforeNudge.top });

  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Resize se')).toBeHidden();

  await page.locator('main img[alt="signature"]').click();
  await expect(page.getByLabel('Resize se')).toBeVisible();

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+S`);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sample-signed.pdf');

  await expect(page.getByText('Done. Downloaded sample-signed.pdf.')).toBeVisible();

  await page.locator('main img[alt="signature"]').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('main img[alt="signature"]')).toHaveCount(0);
  expect(requests).toEqual([]);
});

// Native mouse drags protect dataTransfer.getData outside dragstart/drop;
// dragTo drives the real drag data store, unlike synthetic dispatched events.
test('accepts a native mouse drag from the library onto the page', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'native-drag.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'native-drag.pdf' })).toBeVisible();
  const layer = page.getByTestId('placement-layer');
  await expect(layer).toBeVisible();
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Add library item' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByPlaceholder('Type your name').fill('Drag Signer');
  await expect(page.getByAltText('Typed signature preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Drag Signer', { exact: true })).toBeVisible();

  const handle = page.getByRole('button', { name: 'Drag Signer', exact: true });
  const layerBox = await layer.boundingBox();
  if (!layerBox) {
    throw new Error('Expected placement layer bounds');
  }
  await handle.dragTo(layer, {
    targetPosition: { x: Math.round(layerBox.width * 0.4), y: Math.round(layerBox.height * 0.4) }
  });

  await expect(page.getByRole('status').filter({ hasText: 'Signature placed on page 1.' })).toBeVisible();
  await expect(page.getByTestId('placement-layer').getByRole('button', { name: 'Signature', exact: true })).toHaveCount(1);
});
