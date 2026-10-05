import { inflateSync } from 'node:zlib';
import { degrees, PDFDocument } from 'pdf-lib';

// The export path lazily loads a ~760 KB bundled font plus its shaper, about
// three seconds of one-time setup in jsdom on top of each test's PDF work. The
// default 5 s budget measures that setup, not a hang.
vi.setConfig({ testTimeout: 120_000 });
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

function inflateContentStreams(output: Uint8Array) {
  // Node's latin1 preserves bytes 1:1 so compressed stream data survives
  // the decode (TextDecoder's utf-8 and windows-1252 both corrupt it).
  const outputText = Buffer.from(output).toString('latin1');
  return Array.from(outputText.matchAll(/stream\r?\n([\s\S]*?)endstream/g))
    .map((match) => {
      try {
        return inflateSync(Buffer.from(match[1] ?? '', 'binary')).toString('latin1');
      } catch {
        return '';
      }
    })
    .join('\n');
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
    // Text embeds the bundled DejaVu Sans subset, not a standard font.
    expect(outputText).toContain('/DejaVuSans');
    expect(inflatedStreams).not.toContain('(   )');
    expect(output.byteLength).toBeGreaterThan(document.pdfBytes.byteLength);
    expect(document.pdfBytes).toEqual(originalBytes);
  });

  it('draws signatures at the placement size, not the image natural size', async () => {
    const document = await makeDocument([
      {
        id: 'sig-1',
        type: 'signature',
        assetPngBytes: PNG_BYTES,
        pageIndex: 0,
        x: 0.1,
        y: 0.1,
        w: 0.3,
        h: 0.2
      }
    ]);

    const output = await flattenDocument(document, { dateFormat: 'yyyy-MM-dd' });

    // Placement 0.3x0.2 on a 200x200 page is a 60x40 box. The preview fits the
    // image inside it (object-contain), so the export letterboxes the same way:
    // the 1x1 image draws 40x40, centered in the box at x=30.
    const stream = inflateContentStreams(output);
    expect(stream).toMatch(/\b1 0 0 1 30 140 cm\b/);
    expect(stream).toMatch(/\b40 0 0 40 0 0 cm\b/);
  });

  it('resolves snapshot placements without consulting the live library', async () => {
    const document = await makeDocument([
      { id: 'sig-modern', type: 'signature', snapshotId: 'snapshot-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.2 }
    ]);
    const loadAsset = vi.fn<() => Promise<SignatureAsset | null>>();
    const output = await flattenDocument(document, {
      snapshots: { 'snapshot-1': { id: 'snapshot-1', kind: 'signature', pngBytes: PNG_BYTES, width: 1, height: 1 } },
      loadAsset
    });
    expect(loadAsset).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(output)).toContain('/XObject');
  });

  it('fails instead of producing a blank pdf when a referenced snapshot is missing', async () => {
    const document = await makeDocument([
      { id: 'sig-modern', type: 'signature', snapshotId: 'missing', assetId: 'asset-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.2 }
    ]);
    const loadAsset = vi.fn<() => Promise<SignatureAsset | null>>();

    await expect(flattenDocument(document, { snapshots: {}, loadAsset })).rejects.toThrow(
      "Couldn't write contract.pdf. Try re-saving the PDF from its source."
    );
    expect(loadAsset).not.toHaveBeenCalled();
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

describe('flattenDocument page geometry', () => {
  // pdf-lib emits full float precision (cos(90deg) = 6.12e-17), so compare
  // number tokens rounded to 4 decimals with trailing zeros stripped.
  function normalizeNumbers(content: string): string {
    return content.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g, (token) => {
      const n = Number(token);
      const rounded = n.toFixed(4);
      return String(Number(rounded));
    });
  }

  const rotatedGeometry = {
    width: 340,
    height: 170,
    rotation: 90,
    transform: [0, 1, 1, 0, -20, -10] as [number, number, number, number, number, number],
    viewBox: { x: 10, y: 20, w: 170, h: 340 },
    userUnit: 1
  };

  async function makeRotatedDocument(placements: SessionDocument['placements']): Promise<SessionDocument> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 400]);
    page.setCropBox(10, 20, 170, 340);
    page.setRotation(degrees(90));
    const pdfBytes = await pdf.save({ useObjectStreams: false });
    const sourceBytes = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
    return {
      docId: 'doc-rot',
      fileName: 'rotated.pdf',
      pdfBytes: sourceBytes,
      pageCount: 1,
      pageSizes: [{ w: 340, h: 170 }],
      pageGeometry: [rotatedGeometry],
      placements,
      status: 'placed'
    };
  }

  it('maps a signature rectangle through the 90-degree rotated cropped geometry', async () => {
    const document = await makeRotatedDocument([
      { id: 'sig-1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0.25, y: 0.25, w: 0.2, h: 0.1 }
    ]);
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

    const output = await flattenDocument(document, { loadAsset });
    const content = normalizeNumbers(inflateContentStreams(output));
    // viewer rect (85,42.5)-(153,59.5); the image letterboxes to 17x17 inside
    // the 68x17 box, moving the drawn left edge to viewer x=110.5. Anchor
    // viewer (110.5,59.5) -> user (69.5,130.5) through the 90-degree transform,
    // which swaps axes.
    expect(content).toContain('1 0 0 1 69.5 130.5 cm');
    expect(content).toContain('0 1 -1 0 0 0 cm');
    expect(content).toContain('17 0 0 17 0 0 cm');
  });

  it('maps text through the same geometry with a rotated baseline', async () => {
    const document = await makeRotatedDocument([
      { id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.6, w: 0.3, h: 0.08, value: 'OK', fontSize: 12 }
    ]);

    const output = await flattenDocument(document);
    const content = normalizeNumbers(inflateContentStreams(output));
    // First baseline = box top + padding + half-leading + ascent, matching the
    // preview's first line box. Viewer anchor (34+8, 102+4+11.3543); through the
    // 90-degree inverse: px=42+20=62, py=117.3543+10=127.3543 -> user (127.3543, 62).
    expect(content).toContain('0 1 -1 0 127.3543 62 Tm');
    expect(content).toContain('12 Tf');
  });
});

describe('flattenDocument across all right-angle rotations', () => {
  function normalizeTestNumbers(content: string): string {
    return content.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g, (token) => String(Number(Number(token).toFixed(4))));
  }

  // Pinned to pdf.js PageViewport construction for a 200x400 MediaBox with
  // CropBox [10,20,180,360]: effective viewer 340x170, centerX 95, centerY 190.
  // pdf-lib composes translate ∘ rotate ∘ scale: the scale stays 102x34 and the
  // rotation matrix carries the axis swap that keeps the marker upright.
  // The 1x1 image letterboxes to 34x34 inside the 102x34 viewer box, shifting
  // the drawn left edge +34 in viewer x; each transform maps that shift to its
  // own user-space direction.
  const cases: { rotation: number; transform: [number, number, number, number, number, number]; anchor: [number, number]; rotate: string }[] = [
    { rotation: 0, transform: [1, 0, 0, -1, -10, 360], anchor: [112, 292], rotate: '1 0 0 1 0 0 cm' },
    { rotation: 90, transform: [0, 1, 1, 0, -20, -10], anchor: [78, 122], rotate: '0 1 -1 0 0 0 cm' },
    { rotation: 180, transform: [-1, 0, 0, 1, 180, -20], anchor: [78, 88], rotate: '-1 0 0 -1 0 0 cm' },
    { rotation: 270, transform: [0, -1, -1, 0, 360, 180], anchor: [112, 258], rotate: '0 -1 1 0 0 0 cm' }
  ];

  for (const { rotation, transform, anchor, rotate } of cases) {
    it(`keeps the marker bounds and orientation at ${rotation} degrees`, async () => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([200, 400]);
      page.setCropBox(10, 20, 170, 340);
      page.setRotation(degrees(rotation));
      const pdfBytes = await pdf.save({ useObjectStreams: false });
      const document: SessionDocument = {
        docId: `doc-rot-${rotation}`,
        fileName: 'rot.pdf',
        pdfBytes: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer,
        pageCount: 1,
        pageSizes: [{ w: 340, h: 170 }],
        pageGeometry: [{ width: 340, height: 170, rotation, transform, viewBox: { x: 10, y: 20, w: 170, h: 340 }, userUnit: 1 }],
        placements: [
          { id: 'sig-1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0.2, y: 0.2, w: 0.3, h: 0.2 }
        ],
        status: 'placed'
      };
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

      const output = await flattenDocument(document, { loadAsset });
      const content = normalizeTestNumbers(inflateContentStreams(output));

      // Anchor: viewer rect bottom-left (68, 68) mapped through the inverse transform.
      expect(content).toContain(`1 0 0 1 ${anchor[0]} ${anchor[1]} cm`);
      // Orientation matrix for the page rotation and the rotation-invariant size.
      expect(content).toContain(rotate);
      expect(content).toContain('34 0 0 34 0 0 cm');
    });
  }
});
