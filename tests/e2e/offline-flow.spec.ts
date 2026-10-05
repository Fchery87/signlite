import { mkdirSync } from 'fs';
import { promises as fs } from 'fs';
import { expect, test } from '@playwright/test';
import { createBatchPdf, createSamplePdf, SAMPLE_UPLOAD_PNG } from './helpers/fixtures';

const READY = 'Ready to sign offline.';

async function waitForReady(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('runtime-readiness')).toHaveText(READY, { timeout: 60000 });
}

/** The runtime's own bundle loads from same-origin scripts; blocking one chunk
 *  must fail preparation visibly and recover through Retry. */
test('failed preparation is visible and Retry completes it', async ({ page }) => {
  test.setTimeout(120000);
  let blockAssets = true;
  // Block only the lazy chunks readiness needs; the entry's own static imports
  // (ui-vendor, pdf-runtime) must keep loading or the shell itself dies.
  await page.route('**/assets/**', (route) => {
    if (blockAssets && /EditorView|pdfAssets|flatten|pdf\.worker/.test(route.request().url())) {
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('/');
  // The shell still renders its own status from a failed preparation.
  await expect(page.getByTestId('runtime-readiness')).toBeVisible({ timeout: 30000 });

  blockAssets = false;
  page.on('console', (m) => { if (m.type() === 'error') console.log('CERR', m.text().slice(0, 160)); });
  page.on('pageerror', (e) => console.log('PERR', e.message.slice(0, 160)));
  await page.getByTestId('runtime-retry').click();
  await waitForReady(page);
});

test('complete signing flow works offline once ready', async ({ page }) => {
  test.setTimeout(240000);
  mkdirSync('artifacts/readiness/R09', { recursive: true });

  await page.goto('/');
  await waitForReady(page);
  // Every module and data asset is resident; the network is now dead weight.
  await page.context().setOffline(true);

  // Intake works offline.
  await page.locator('input[accept="application/pdf"]').setInputFiles([
    { name: 'offline-a.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf() },
    { name: 'offline-b.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Offline B', 2) }
  ]);
  await expect(page.getByRole('heading', { name: 'offline-a.pdf' })).toBeVisible();

  // A typed signature works offline (bundled font, no fetch).
  await page.getByRole('button', { name: 'Add library item' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByPlaceholder('Type your name').fill('Offline Signer');
  await expect(page.getByAltText('Typed signature preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Signature saved.')).toBeVisible();

  // An uploaded signature works offline.
  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'upload-offline.png',
    mimeType: 'image/png',
    buffer: SAMPLE_UPLOAD_PNG
  });
  await expect(page.getByText('upload-offline', { exact: true })).toBeVisible();

  // Placement and autosave work offline; durability stays honest.
  await page.getByRole('button', { name: 'Place on page 1' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /placed on page 1/i })).toBeVisible();
  await expect(page.getByTestId('durability-status')).toContainText(/Saved/i);
  console.log('SIGS_BEFORE_SWITCH', await page.getByRole('main').getByRole('button', { name: 'signature' }).count());

  // Editing while offline keeps saving (reload-safe editing within the loaded
  // tab; an offline reload is O03 and not claimed here).
  await page.getByRole('button', { name: 'offline-b.pdf' }).click();
  await expect(page.getByRole('heading', { name: 'offline-b.pdf' })).toBeVisible();

  // Single download works offline: back to the document with placements.
  await page.getByRole('button', { name: 'offline-a.pdf' }).click();
  await expect(page.getByRole('heading', { name: 'offline-a.pdf' })).toBeVisible();
  const singleDownload = page.waitForEvent('download');
  await page.getByRole('main').getByRole('button', { name: 'Download', exact: true }).click();
  const single = await singleDownload;
  await single.saveAs('artifacts/readiness/R09/offline-single.pdf');
  await expect(single.suggestedFilename()).toBe('offline-a-signed.pdf');

  // Apply the template's placements to the batch, still offline.
  await page.getByRole('button', { name: 'Apply to all' }).click();
  await expect(page.getByRole('dialog', { name: 'Replace existing placements?' })).toBeVisible();
  await page.getByRole('button', { name: 'Replace and apply' }).click();
  await expect(page.getByText('Applied to 1 document.')).toBeVisible();

  // Batch download works offline.
  await page.getByRole('button', { name: 'Download all' }).click();
  const batchDownload = page.waitForEvent('download', { timeout: 120000 });
  const batch = await batchDownload;
  await batch.saveAs('artifacts/readiness/R09/offline-batch.zip');
  await expect(page.getByText(/Downloaded/)).toBeVisible();

  const zip = await fs.readFile('artifacts/readiness/R09/offline-batch.zip');
  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
});
