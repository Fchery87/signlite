import { expect, test } from '@playwright/test';
import { createCMapPdf } from './helpers/pdfAssets';
import { createSamplePdf } from './helpers/fixtures';

async function glyphPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('main canvas').first().evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected page canvas');
    const context = element.getContext('2d');
    if (!context || !element.width || !element.height) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && pixels[index] < 128 && pixels[index + 1] < 128 && pixels[index + 2] < 128) dark++;
    }
    return dark;
  });
}

async function loadPdf(page: import('@playwright/test').Page, buffer: Buffer, name: string) {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error' || /Warning:/.test(message.text())) warnings.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('runtime-readiness')).toHaveText('Ready to sign offline.', { timeout: 60000 });
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  return warnings;
}

test('renders a valid CMap PDF with glyph output and no font diagnostics', async ({ page }) => {
  const warnings = await loadPdf(page, await createCMapPdf(), 'cmap.pdf');
  await expect(page.getByRole('heading', { name: 'cmap.pdf' })).toBeVisible();
  await expect.poll(() => glyphPixels(page)).toBeGreaterThan(100);
  expect(warnings.filter((warning) => /font|cmap|standardfont/i.test(warning))).toEqual([]);
});

test('pdf.js diagnoses the rejected missing CMap resource in an otherwise valid PDF', async ({ page }) => {
  const warnings = await loadPdf(page, await createCMapPdf('ValidButMissing-CMap'), 'missing-cmap.pdf');
  await expect(page.getByRole('heading', { name: 'missing-cmap.pdf' })).toBeVisible();
  // pdf.js converts a rejected font load to an ErrorFont and logs its cause.
  // Its document parser does not reject the entire otherwise-valid document.
  await expect.poll(() => warnings.join('\n')).toContain('Unknown CMap name: ValidButMissing-CMap');
  await expect(page.getByText('Rendering page…')).toBeHidden();
  expect(await glyphPixels(page)).toBe(0);
});

test('renders standard-font glyphs without auxiliary font diagnostics', async ({ page }) => {
  const warnings = await loadPdf(page, await createSamplePdf(), 'standard-font.pdf');
  await expect(page.getByRole('heading', { name: 'standard-font.pdf' })).toBeVisible();
  await expect.poll(() => glyphPixels(page)).toBeGreaterThan(100);
  expect(warnings.filter((warning) => /font|cmap|standardfont/i.test(warning))).toEqual([]);
});
