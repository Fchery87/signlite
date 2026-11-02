import { expect, test } from '@playwright/test';
import { SAMPLE_UPLOAD_PNG, createBatchPdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

test('text and date actions stay reachable at 320px and dialogs own portal-toolbar focus', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'boundaries.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Boundaries', 2) });
  await openQueuedDocument(page, 'boundaries.pdf');
  for (const kind of ['Text', 'Date']) {
    await page.getByRole('button', { name: 'Show library', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Library', exact: true });
    await library.getByRole('button', { name: kind, exact: true }).click();
    await expect(library).toBeHidden();
    const toolbar = page.getByRole('toolbar', { name: 'Selected element' });
    for (const name of ['Duplicate', 'Copy', 'Deselect', 'Delete']) {
      await expect(toolbar.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await expect(toolbar.getByRole('spinbutton', { name: 'Size' })).toBeInViewport({ ratio: 1 });
    if (kind === 'Text') {
      await toolbar.getByRole('button', { name: 'Edit', exact: true }).click();
      const input = page.getByRole('textbox', { name: 'Element text' });
      await input.fill('Narrow signing');
      await input.press('Enter');
    } else {
      await toolbar.getByRole('button', { name: 'Cycle format' }).click();
    }
    await page.getByRole('button', { name: '150%', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Delete', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeFocused();
    await toolbar.getByRole('button', { name: 'Deselect' }).click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show library', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByTestId('placement-layer').nth(1).getByRole('button', { name: 'Text', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('narrow-text-controls.png'), fullPage: true });
});

test('cancelling an armed library preview leaves existing placements unchanged', async ({ page }) => {
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'cancel-arm.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Cancel arm', 1) });
  await openQueuedDocument(page, 'cancel-arm.pdf');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const layer = page.getByTestId('placement-layer');
  await expect(layer.getByRole('button', { name: 'Text', exact: true })).toHaveCount(1);
  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({ name: 'arm-only.png', mimeType: 'image/png', buffer: SAMPLE_UPLOAD_PNG });
  await page.getByRole('button', { name: 'arm-only', exact: true }).click();
  const armedStatus = page.getByRole('status').filter({ hasText: 'Click or tap a page to place your signature.' });
  await expect(armedStatus).toBeVisible();
  await armedStatus.getByRole('button', { name: 'Cancel', exact: true }).click();
  await layer.click({ position: { x: 280, y: 250 } });
  await expect(layer.getByRole('button', { name: 'Signature', exact: true })).toHaveCount(0);
  await expect(layer.getByRole('button', { name: 'Text', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(layer.getByRole('button', { name: 'Text', exact: true })).toHaveCount(0);
});
