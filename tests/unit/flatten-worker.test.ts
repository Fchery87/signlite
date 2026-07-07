import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import type { SessionDocument } from '../../src/db/schema';
import { runFlattenJob, type FlattenWorkerRequest } from '../../src/workers/flatten.worker';

async function makeDocument(docId: string, fileName: string, placements: SessionDocument['placements']): Promise<SessionDocument> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const pdfBytes = await pdf.save({ useObjectStreams: false });
  const sourceBytes = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;

  return {
    docId,
    fileName,
    pdfBytes: sourceBytes,
    pageCount: 1,
    pageSizes: [{ w: 200, h: 200 }],
    placements,
    status: 'placed'
  };
}

describe('runFlattenJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('zips successful documents and continues after per-doc failure', async () => {
    const goodDocument = await makeDocument('doc-1', 'lease.pdf', [
      { id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.1, value: 'Signed', fontSize: 12 }
    ]);
    const duplicateNameDocument = await makeDocument('doc-2', 'lease.pdf', [
      { id: 'text-2', type: 'text', pageIndex: 0, x: 0.2, y: 0.2, w: 0.3, h: 0.1, value: 'Approved', fontSize: 12 }
    ]);
    const brokenDocument = {
      ...goodDocument,
      docId: 'doc-3',
      fileName: 'broken.pdf',
      pdfBytes: new Uint8Array([0, 1, 2, 3]).buffer
    } satisfies SessionDocument;

    const progressMessages: Array<{ docId: string; done: number; total: number }> = [];
    const errorMessages: Array<{ docId?: string; message: string }> = [];
    const worker = {
      postMessage(message: unknown) {
        const nextMessage = message as { kind: string; docId?: string; done?: number; total?: number; message?: string };

        if (nextMessage.kind === 'progress' && nextMessage.docId && nextMessage.done && nextMessage.total) {
          progressMessages.push({ docId: nextMessage.docId, done: nextMessage.done, total: nextMessage.total });
        }

        if (nextMessage.kind === 'error') {
          errorMessages.push({ docId: nextMessage.docId, message: nextMessage.message ?? '' });
        }
      }
    };

    const request: FlattenWorkerRequest = {
      kind: 'flatten',
      docs: [goodDocument, duplicateNameDocument, brokenDocument],
      assets: {},
      zip: true,
      dateFormat: 'yyyy-MM-dd'
    };

    const result = await runFlattenJob(request, worker);
    const files = unzipSync(new Uint8Array(result.output));

    expect(result.kind).toBe('done');
    expect(result.mime).toBe('application/zip');
    expect(Object.keys(files)).toEqual(['lease-signed.pdf', 'lease-signed-2.pdf']);
    expect(progressMessages).toEqual([
      { docId: 'doc-1', done: 1, total: 3 },
      { docId: 'doc-2', done: 2, total: 3 }
    ]);
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0]?.docId).toBe('doc-3');
    await expect(PDFDocument.load(files['lease-signed.pdf'])).resolves.toBeTruthy();
  });

  it('fails the batch when every document errors', async () => {
    const brokenDocument = {
      ...(await makeDocument('doc-1', 'broken.pdf', [
        { id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.1, value: 'Signed', fontSize: 12 }
      ])),
      pdfBytes: new Uint8Array([0, 1, 2, 3]).buffer
    } satisfies SessionDocument;

    const request: FlattenWorkerRequest = {
      kind: 'flatten',
      docs: [brokenDocument],
      assets: {},
      zip: true,
      dateFormat: 'yyyy-MM-dd'
    };

    await expect(runFlattenJob(request)).rejects.toThrow('Could not sign any of these PDFs.');
  });
});
