import { PDF_CMAPS, PDF_STANDARD_FONTS, type PdfAsset } from './generated/pdfAssets';

function decodeAsset(asset: PdfAsset): Uint8Array {
  return Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0));
}

const cmapTable = new Map(PDF_CMAPS.map((asset) => [asset.name, asset]));
const standardFontTable = new Map(PDF_STANDARD_FONTS.map((asset) => [asset.name, asset]));

/** Serves CMaps and standard font data from the resident bundle. pdf.js's
 *  default factories fetch these at render time, which the content security
 *  policy forbids (`connect-src 'none'`), so a CJK-encoded or standard-font
 *  PDF would silently fail to render. pdf.js constructs these with `new` and
 *  calls `fetch({ name })` / `fetch({ filename })`.
 *
 *  This module exists so the 2.6 MB data table stays out of the entry chunk:
 *  render.ts is reachable from the session store, and a static import there
 *  would drag the table into every page load. */
export class BundledCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const asset = cmapTable.get(name);
    if (!asset) throw new Error(`CMap ${name} is not bundled`);
    return { cMapData: decodeAsset(asset), isCompressed: true };
  }
}

export class BundledStandardFontDataFactory {
  async fetch({ filename }: { filename: string }) {
    const asset = standardFontTable.get(filename);
    if (!asset) throw new Error(`Standard font ${filename} is not bundled`);
    return { data: decodeAsset(asset) };
  }
}
