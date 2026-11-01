import { describe, expect, it } from 'vitest';
import {
  BundledCMapReaderFactory,
  BundledStandardFontDataFactory
} from '../../src/pdf/assetFactories';

describe('bundled pdf assets', () => {
  it('resolves suffix-free CMap names through the production factory', async () => {
    const result = await new BundledCMapReaderFactory().fetch({ name: '90ms-RKSJ-H' });
    expect(result.cMapData).toBeInstanceOf(Uint8Array);
    expect(result.cMapData.byteLength).toBeGreaterThan(0);
    expect(result.isCompressed).toBe(true);
  });

  it('returns standard font bytes directly through the production factory', async () => {
    const { PDF_STANDARD_FONTS } = await import('../../src/pdf/generated/pdfAssets');
    const result = await new BundledStandardFontDataFactory().fetch({ filename: PDF_STANDARD_FONTS[0].name });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('rejects a missing CMap resource', async () => {
    await expect(new BundledCMapReaderFactory().fetch({ name: 'missing-cmap' })).rejects.toThrow(
      'CMap missing-cmap is not bundled'
    );
  });
});
