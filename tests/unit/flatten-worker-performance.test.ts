import { performance } from 'node:perf_hooks';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { runFlattenJob, type FlattenWorkerRequest } from '../../src/workers/flatten.worker';
import type { SessionDocument } from '../../src/db/schema';

type BatchPerformanceResult = {
  documentCount: number;
  pageCount: number;
  sourceBytes: number;
  elapsedMs: number;
  completedDocumentIds: string[];
  failedDocumentIds: string[];
};

const DOCUMENT_COUNT = 20;
const PAGES_PER_DOCUMENT = 10;
const MAX_ELAPSED_MS = 30_000;

async function createPerformanceDocument(docId: string): Promise<SessionDocument> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageIndex = 0; pageIndex < PAGES_PER_DOCUMENT; pageIndex += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Performance fixture ${docId} page ${pageIndex + 1}`, {
      x: 72,
      y: 700,
      size: 18,
      font
    });
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  const pdfBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return {
    docId,
    fileName: `${docId}.pdf`,
    pdfBytes,
    pageCount: PAGES_PER_DOCUMENT,
    pageSizes: Array.from({ length: PAGES_PER_DOCUMENT }, () => ({ w: 612, h: 792 })),
    placements: [{
      id: `placement-${docId}`,
      type: 'text',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.3,
      h: 0.1,
      value: 'Signed',
      fontSize: 12
    }],
    status: 'placed'
  };
}

async function runPerformanceFixture(): Promise<BatchPerformanceResult> {
  const docs = await Promise.all(
    Array.from({ length: DOCUMENT_COUNT }, (_, index) => createPerformanceDocument(`performance-${index + 1}`))
  );
  const completedDocumentIds: string[] = [];
  const failedDocumentIds: string[] = [];
  const startedAt = performance.now();
  const request: FlattenWorkerRequest = {
    kind: 'flatten',
    docs,
    assets: {},
    zip: true,
    dateFormat: 'yyyy-MM-dd'
  };
  const result = await runFlattenJob(request, {
    postMessage(message: unknown) {
      const next = message as { kind: string; docId?: string };
      if (next.kind === 'progress' && next.docId) completedDocumentIds.push(next.docId);
      if (next.kind === 'error' && next.docId) failedDocumentIds.push(next.docId);
    }
  });

  expect(result.kind).toBe('done');
  return {
    documentCount: docs.length,
    pageCount: docs.reduce((total, doc) => total + doc.pageCount, 0),
    sourceBytes: docs.reduce((total, doc) => total + doc.pdfBytes.byteLength, 0),
    elapsedMs: Math.round(performance.now() - startedAt),
    completedDocumentIds,
    failedDocumentIds
  };
}

describe('batch performance fixture', () => {
  it('flattens a 20-document by 10-page stack within the local budget', async () => {
    const result = await runPerformanceFixture();

    expect(result.documentCount).toBe(DOCUMENT_COUNT);
    expect(result.pageCount).toBe(DOCUMENT_COUNT * PAGES_PER_DOCUMENT);
    expect(result.sourceBytes).toBeGreaterThan(0);
    expect(result.completedDocumentIds).toHaveLength(DOCUMENT_COUNT);
    expect(result.failedDocumentIds).toHaveLength(0);
    expect(result.elapsedMs).toBeLessThan(MAX_ELAPSED_MS);
  }, MAX_ELAPSED_MS + 10_000);
});
