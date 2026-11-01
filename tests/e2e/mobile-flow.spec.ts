import { expect, test } from '@playwright/test';
import { SAMPLE_UPLOAD_PNG, createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

test('completes a signing flow on a narrow screen', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'mobile-doc.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await page.getByLabel('Create signature').click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'mobile-signature.png',
    mimeType: 'image/png',
    buffer: SAMPLE_UPLOAD_PNG
  });
  await expect(page.getByAltText('mobile-signature')).toBeVisible();

  await page.getByRole('button', { name: 'More actions for mobile-doc.pdf' }).click();
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'mobile-doc.pdf' })).toBeVisible({ timeout: 30000 });
  const layer = page.getByTestId('placement-layer').first();
  await expect(layer).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  const box = await layer.boundingBox();
  if (!box) throw new Error('Expected placement layer bounds');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect(page.getByRole('status').filter({ hasText: 'Signature placed on page 1.' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mobile-doc-signed.pdf');
});
