import { expect, test } from '@playwright/test';
import { createSamplePdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

test('keyboard users open and dismiss narrow tool dialogs and retain desktop panels', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await openQueuedDocument(page, 'sample.pdf');

  const pages = page.getByRole('button', { name: 'Show pages' });
  await expect(pages).toBeVisible();
  await pages.focus();
  await page.keyboard.press('Enter');
  const pagesDialog = page.getByRole('dialog', { name: 'Pages', exact: true });
  await expect(pagesDialog).toBeVisible();
  await expect(pagesDialog.getByRole('heading', { name: 'Pages' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pagesDialog).toBeHidden();
  await expect(pages).toBeFocused();

  await page.getByRole('button', { name: 'Show library' }).click();
  await expect(page.getByRole('dialog', { name: 'Library', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show pages' })).toBeHidden();
});

test('a clear confirmation traps Tab and returns focus when cancelled', async ({ page }) => {
  await page.goto('/');
  await waitForRuntimeReady(page);
  const opener = page.getByTestId('clear-history');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Clear document history?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('older than 7 days')).toBeVisible();

  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the document queue does not overflow a narrow viewport', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'queue-narrow.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });

  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator('table').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Add PDFs' })).toBeVisible();
});
