import { expect, test } from '@playwright/test';
import { createCMapPdf } from './helpers/pdfAssets';

async function loadPdf(page: import('@playwright/test').Page, buffer: Buffer, name: string) {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('runtime-readiness')).toHaveText('Ready to sign offline.', { timeout: 60000 });
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  return warnings;
}

test('renders a valid CMap PDF with glyph output and no font diagnostics', async ({ page }) => {
  const warnings = await loadPdf(page, createCMapPdf(), 'cmap.pdf');
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'cmap.pdf' })).toBeVisible();
  const paintedPixels = await page.locator('canvas').first().evaluate((canvas) => {
    const context = canvas.getContext('2d');
    if (!context) return 0;
    return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data).filter((value) => value !== 0).length;
  });
  expect(paintedPixels).toBeGreaterThan(0);
  expect(warnings.filter((warning) => /font|cmap|standardfont/i.test(warning))).toEqual([]);
});

test('reports a valid PDF with an unavailable CMap instead of silently succeeding', async ({ page }) => {
  await loadPdf(page, createCMapPdf('ValidButMissing-CMap'), 'missing-cmap.pdf');
  await expect(page.getByText(/unable to render|failed|error/i).first()).toBeVisible({ timeout: 30000 });
});
