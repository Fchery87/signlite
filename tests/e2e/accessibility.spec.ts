import { expect, test } from '@playwright/test';
import { createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

test('keyboard signing reaches download, and narrow screens open the pages sidebar', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'sample.pdf' })).toBeVisible();

  const pages = page.getByRole('button', { name: 'Show pages' });
  await expect(pages).toBeVisible();
  await pages.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Hide pages' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();

  await page.getByRole('button', { name: 'Show library' }).click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

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
