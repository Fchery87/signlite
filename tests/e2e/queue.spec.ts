import { expect, test } from '@playwright/test';
import { SAMPLE_UPLOAD_PNG, createBatchPdf, waitForRuntimeReady } from './helpers/fixtures';

test('uploads a signature, replaces existing placements, and reorders the queue', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles([
    { name: 'doc-one.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('One', 1) },
    { name: 'doc-two.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Two', 1) },
    { name: 'doc-three.pdf', mimeType: 'application/pdf', buffer: await createBatchPdf('Three', 1) }
  ]);
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({ timeout: 60000 });

  await page.getByLabel('Create signature').click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'queue-upload.png',
    mimeType: 'image/png',
    buffer: SAMPLE_UPLOAD_PNG
  });
  await expect(page.getByAltText('queue-upload')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Select doc-one.pdf' }).click();
  await page.getByRole('checkbox', { name: 'Select doc-two.pdf' }).click();
  await page.getByRole('button', { name: 'Apply signature' }).click();
  await expect(page.getByRole('dialog', { name: 'Apply signature to 2 documents' })).toContainText('The saved signature is placed on page 1 of 2 documents.');
  await page.getByRole('button', { name: 'Apply to 2 documents' }).click();
  await expect(page.getByText('Signature added to 2 documents.')).toBeVisible();

  await page.getByRole('button', { name: 'Apply signature' }).click();
  const replacementDialog = page.getByRole('dialog', { name: 'Apply signature to 2 documents' });
  await expect(replacementDialog).toContainText('Existing signatures or initials are replaced on 2 documents.');
  await page.getByRole('button', { name: 'Apply to 2 documents' }).click();

  const firstHandle = page.getByRole('button', { name: /Reorder doc-one\.pdf/ });
  await firstHandle.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByTestId('queue-row').first()).toContainText('doc-two.pdf');
});
