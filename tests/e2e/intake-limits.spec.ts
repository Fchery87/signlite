import { expect, test } from '@playwright/test';
import { createBatchPdf, waitForRuntimeReady } from './helpers/fixtures';

// R03 intake ceilings: the 51st document is refused before parsing, mixed
// batches report per file, and non-PDF native drops never navigate away.
test('refuses the 51st document of an oversized batch without parsing it', async ({ page }) => {
  test.setTimeout(120000);

  const onePagePdf = await createBatchPdf('intake-limit', 1);
  const files = Array.from({ length: 51 }, (_, index) => ({
    name: `doc-${String(index).padStart(2, '0')}.pdf`,
    mimeType: 'application/pdf',
    buffer: onePagePdf
  }));

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles(files);

  // 50 documents make it in; the 51st is named in the refusal.
  await expect(page.getByText('50 documents loaded.')).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'doc-49.pdf, Pending' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'doc-50.pdf — Session limit is 50 documents.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'doc-50.pdf, Pending' })).toHaveCount(0);
});

test('accepts the valid subset of a mixed batch and reports each rejected file', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await waitForRuntimeReady(page);

  const pdfBuffer = await createBatchPdf('mixed-batch', 1);
  await page.locator('input[accept="application/pdf"]').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: pdfBuffer },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf') },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: pdfBuffer }
  ]);

  await expect(page.getByText('2 documents loaded.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'first.pdf, Pending' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'second.pdf, Pending' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'notes.txt, Pending' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'notes.txt — PDF only for now.' })).toBeVisible();
});

test('a native drop of a non-PDF never navigates away', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await waitForRuntimeReady(page);
  const urlBefore = page.url();

  await page.evaluate(() => {
    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const target = document.querySelector('section');
    if (!target) {
      throw new Error('Expected drop target section');
    }
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });

  await expect(page.getByRole('status').filter({ hasText: 'notes.txt — PDF only for now.' })).toBeVisible();
  expect(page.url()).toBe(urlBefore);
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await waitForRuntimeReady(page);
});
