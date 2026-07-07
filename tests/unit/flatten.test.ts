import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { collectAssetIds, flattenDocument } from '../../src/pdf/flatten';
import type { SessionDocument, SignatureAsset } from '../../src/db/schema';

const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII='),
  (value) => value.charCodeAt(0)
).buffer;

async function makeDocument(placements: SessionDocument['placements']): Promise<SessionDocument> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const pdfBytes = await pdf.save({ useObjectStreams: false });
  const sourceBytes = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
  return {
    docId: 'doc-1',
    fileName: 'contract.pdf',
    pdfBytes: sourceBytes,
    pageCount: 1,
    pageSizes: [{ w: 200, h: 200 }],
    placements,
    status: 'placed'
  };
}

describe('flattenDocument', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flattens signatures and text into a new pdf without mutating source bytes', async () => {
    const document = await makeDocument([
      { id: 'sig-1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
      { id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.4, w: 0.3, h: 0.1, value: 'Signed Here', fontSize: 14 },
      { id: 'text-2', type: 'text', pageIndex: 0, x: 0.1, y: 0.55, w: 0.3, h: 0.1, value: '   ', fontSize: 14 },
      { id: 'date-1', type: 'date', pageIndex: 0, x: 0.1, y: 0.7, w: 0.3, h: 0.1, value: 'yyyy-MM-dd', fontSize: 12 }
    ]);
    const originalBytes = document.pdfBytes.slice(0);
    const loadAsset = vi.fn<() => Promise<SignatureAsset | null>>().mockResolvedValue({
      id: 'asset-1',
      kind: 'signature',
      source: 'uploaded',
      pngBytes: PNG_BYTES,
      width: 1,
      height: 1,
      label: 'Sig',
      createdAt: 1,
      lastUsedAt: 1
    });

    const output = await flattenDocument(document, { loadAsset, dateFormat: 'yyyy-MM-dd' });
    const outputText = new TextDecoder().decode(output);
    const outputPdf = await PDFDocument.load(output);
    const inflatedStreams = Array.from(outputText.matchAll(/stream\r?\n([\s\S]*?)endstream/g))
      .map((match) => {
        try {
          return inflateSync(Buffer.from(match[1] ?? '', 'binary')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');

    expect(loadAsset).toHaveBeenCalledWith('asset-1');
    expect(loadAsset).toHaveBeenCalledTimes(1);
    expect(outputPdf.getPageCount()).toBe(1);
    expect(outputText).toContain('/XObject');
    expect(outputText).toContain('/Helvetica');
    expect(inflatedStreams).not.toContain('(   )');
    expect(output.byteLength).toBeGreaterThan(document.pdfBytes.byteLength);
    expect(document.pdfBytes).toEqual(originalBytes);
  });

  it('falls back to cached placement png bytes when the library asset is gone', async () => {
    const document = await makeDocument([
      {
        id: 'sig-1',
        type: 'signature',
        assetId: 'asset-1',
        assetPngBytes: PNG_BYTES,
        pageIndex: 0,
        x: 0.1,
        y: 0.1,
        w: 0.3,
        h: 0.2
      }
    ]);
    const loadAsset = vi.fn<() => Promise<SignatureAsset | null>>().mockResolvedValue(null);

    const output = await flattenDocument(document, { loadAsset, dateFormat: 'yyyy-MM-dd' });
    const outputText = new TextDecoder().decode(output);

    expect(loadAsset).toHaveBeenCalledWith('asset-1');
    expect(outputText).toContain('/XObject');
  });

  it('wraps flatten failures with the source-file recovery copy', async () => {
    const brokenDocument = {
      ...(await makeDocument([{ id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1, value: 'Hi' }])),
      fileName: 'broken.pdf',
      pdfBytes: new Uint8Array([0, 1, 2]).buffer
    } satisfies SessionDocument;

    await expect(flattenDocument(brokenDocument)).rejects.toThrow(
      "Couldn't write broken.pdf. Try re-saving the PDF from its source."
    );
  });

  it('collects unique asset ids across documents', async () => {
    const firstDocument = await makeDocument([
      { id: 'sig-1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
      { id: 'sig-2', type: 'initials', assetId: 'asset-2', pageIndex: 0, x: 0.2, y: 0.2, w: 0.2, h: 0.1 }
    ]);
    const secondDocument = await makeDocument([
      { id: 'sig-3', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0.3, y: 0.3, w: 0.2, h: 0.1 }
    ]);

    expect(collectAssetIds([firstDocument, secondDocument])).toEqual(['asset-1', 'asset-2']);
  });
});
