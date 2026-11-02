import { expect, test } from '@playwright/test';
import { SAMPLE_UPLOAD_PNG, createBatchPdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

test('editor hierarchy, tools, placement controls and navigation remain usable at every size', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'editor-review.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Editor review', 2) });
  await openQueuedDocument(page, 'editor-review.pdf');
  await expect(page.getByRole('heading', { name: 'editor-review.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();
  await expect(page.getByText('Choose a signature, initials, date or text to begin.')).toBeVisible();
  const navigation = page.getByRole('toolbar', { name: 'Document navigation' });
  await navigation.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Page 2/ })).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('button', { name: 'Previous page' }).click();
  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({ name: 'Review signature.png', mimeType: 'image/png', buffer: SAMPLE_UPLOAD_PNG });
  await page.getByRole('button', { name: 'Review signature', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Click.*page.*place|click.*place|Tap.*place/i })).toBeVisible();
  const layer = page.getByTestId('placement-layer').first();
  await layer.click({ position: { x: 150, y: 150 } });
  await expect(layer.getByRole('button', { name: 'Signature', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('editor-desktop.png'), fullPage: true });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const signature = layer.getByRole('button', { name: 'Signature', exact: true });
    await signature.click();
    const controls = page.getByRole('toolbar', { name: 'Selected element' });
    await expect(controls).toBeInViewport();
    await expect(controls.getByRole('button', { name: 'Delete', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await controls.getByRole('button', { name: 'Deselect' }).click();
    await expect(controls).toBeHidden();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show library', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Library', exact: true });
  await page.screenshot({ path: test.info().outputPath('editor-phone-tools.png'), fullPage: true });
  await tools.getByRole('button', { name: 'Review signature', exact: true }).click();
  await expect(tools).toBeHidden();
  await layer.click({ position: { x: 100, y: 200 } });
  await expect(layer.getByRole('button', { name: 'Signature', exact: true })).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('editor-phone.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('editor-review-signed.pdf');
  await expect(page.getByRole('status').filter({ hasText: 'Downloaded. Any new changes will need a fresh download.' })).toBeVisible();
});
