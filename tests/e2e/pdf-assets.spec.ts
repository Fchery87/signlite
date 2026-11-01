import { test, expect } from '@playwright/test';

/** Browser-level smoke test for the production PDF.js resource adapters. */
test('bundled PDF factories render text without font warnings', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BundledCMapReaderFactory, BundledStandardFontDataFactory } = await import('../../src/pdf/assetFactories');
    const cmap = await new BundledCMapReaderFactory().fetch({ name: '90ms-RKSJ-H' });
    const font = await new BundledStandardFontDataFactory().fetch({ filename: 'FoxitFixed.pfb' });
    return { cmapBytes: cmap.cMapData.byteLength, compressed: cmap.isCompressed, fontBytes: font.byteLength };
  });
  expect(result.cmapBytes).toBeGreaterThan(0);
  expect(result.compressed).toBe(true);
  expect(result.fontBytes).toBeGreaterThan(0);
  expect(warnings.filter((warning) => /font|cmap/i.test(warning))).toEqual([]);
});
