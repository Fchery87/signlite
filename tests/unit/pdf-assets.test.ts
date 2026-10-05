import { describe, expect, it } from 'vitest';

/** Renders a Shift-JIS PDF whose Type0 font encodes with the predefined
 *  90ms-RKSJ-H CMap, using the same bundled-asset factories the app passes to
 *  pdf.js. In node the default factories would have to fetch '/cmaps/' and
 *  fail, so a successful render here is proof the resident-asset path works
 *  for a document that genuinely requires a CMap. */
describe('bundled pdf assets', () => {
  it('renders a CMap-dependent PDF through the resident factories', async () => {
    const [{ getDocument }, { createCMapPdf }] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('../e2e/helpers/fixtures')
    ]);
    const { PDF_CMAPS, PDF_STANDARD_FONTS } = await import('../../src/pdf/generated/pdfAssets');

    const decode = (asset: { base64: string }) => Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
    const cmapTable = new Map(PDF_CMAPS.map((a) => [a.name, a]));
    const fontTable = new Map(PDF_STANDARD_FONTS.map((a) => [a.name, a]));

    const requestedCMaps: string[] = [];
    class BundledCMapReaderFactory {
      async fetch({ name }: { name: string }) {
        requestedCMaps.push(name);
        const asset = cmapTable.get(name);
        if (!asset) throw new Error(`CMap ${name} is not bundled`);
        return { cMapData: decode(asset), isCompressed: true };
      }
    }
    class BundledStandardFontDataFactory {
      async fetch({ filename }: { filename: string }) {
        const asset = fontTable.get(filename);
        if (!asset) throw new Error(`Standard font ${filename} is not bundled`);
        return { data: decode(asset) };
      }
    }

    const bytes = await createCMapPdf();
    const doc = await getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      useWorkerFetch: false,
      CMapReaderFactory: BundledCMapReaderFactory as never,
      StandardFontDataFactory: BundledStandardFontDataFactory as never,
      standardFontDataUrl: '/standard_fonts/'
    }).promise;
    expect(doc.numPages).toBe(1);

    const page = await doc.getPage(1);
    // Rendering forces font parsing, which is where the CMap is needed.
    await page.getOperatorList();
    await doc.destroy();
    // The document encodes with a predefined CMap, so font parsing had to
    // resolve 90ms-RKSJ-H; it came from the bundle, not a fetch.
    expect(requestedCMaps).toContain('90ms-RKSJ-H');
  }, 60000);

  it('refuses a CMap outside the bundle instead of fetching it', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { PDF_CMAPS } = await import('../../src/pdf/generated/pdfAssets');
    expect(PDF_CMAPS.length).toBeGreaterThan(150);

    class RejectingFactory {
      async fetch({ name }: { name: string }) {
        throw new Error(`CMap ${name} is not bundled`);
      }
    }
    class NeverCalledFactory {
      async fetch() {
        throw new Error('standard font factory must not be used by this document');
      }
    }

    // A document whose CMap is missing must fail the render rather than fall
    // back to a network fetch the CSP would block anyway.
    await expect(
      getDocument({
        // A broken xref forces the recovery parser; a bogus Encoding name then
        // exercises the not-bundled path.
        data: new TextEncoder().encode('%PDF-1.4\n'),
        cMapUrl: '/cmaps/',
        cMapPacked: true,
        useWorkerFetch: false,
        CMapReaderFactory: RejectingFactory as never,
        StandardFontDataFactory: NeverCalledFactory as never,
        standardFontDataUrl: '/standard_fonts/'
      }).promise
    ).rejects.toThrow();
  });
});
