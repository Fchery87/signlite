import { loadDocument, SignlitePdfError } from '../pdf/render';
import type { SessionDocument } from '../db/schema';

export { batchZipFileName, dedupeFileName, signedPdfFileName, stemFromFileName } from './downloadNames';

export function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_SESSION_FILES = 50;
export const MAX_SESSION_PAGES = 500;
export const MAX_SESSION_BYTES = 500 * 1024 * 1024;

export type SessionResourceBudget = {
  documentCount: number;
  pageCount: number;
  byteCount: number;
};

export type FileValidationError = 'pdf-only' | 'too-large' | 'session-limit' | 'session-page-limit' | 'session-byte-limit' | 'encrypted' | 'corrupt';

type CreateSessionDocumentOptions = {
  currentPageCount?: number;
  acceptedPageCount?: number;
};

class SessionPageLimitError extends Error {
  constructor() {
    super('session-page-limit');
  }
}

export function getFileValidationError(
  file: File,
  budget: SessionResourceBudget
): FileValidationError | null {
  if (file.type !== 'application/pdf') return 'pdf-only';
  if (file.size > MAX_FILE_SIZE) return 'too-large';
  if (budget.documentCount >= MAX_SESSION_FILES) return 'session-limit';
  if (budget.pageCount > MAX_SESSION_PAGES) return 'session-page-limit';
  if (budget.byteCount + file.size > MAX_SESSION_BYTES) return 'session-byte-limit';
  return null;
}

export async function createSessionDocument(file: File, options: CreateSessionDocumentOptions = {}): Promise<SessionDocument> {
  const pdfBytes = await file.arrayBuffer();
  let pdf;

  try {
    pdf = await loadDocument(pdfBytes.slice(0));
  } catch (error) {
    if (error instanceof SignlitePdfError) {
      throw error;
    }
    throw new SignlitePdfError('corrupt');
  }

  if (pdf.numPages < 1) {
    throw new SignlitePdfError('corrupt');
  }

  const currentPageCount = options.currentPageCount ?? 0;
  const acceptedPageCount = options.acceptedPageCount ?? 0;
  if (currentPageCount + acceptedPageCount + pdf.numPages > MAX_SESSION_PAGES) {
    throw new SessionPageLimitError();
  }

  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      // The scale-1 viewport is the preview's coordinate system; its transform
      // (UserUnit included) is what the exporter inverts.
      const [a, b, c, d, e, f] = viewport.transform;
      return {
        size: { w: viewport.width, h: viewport.height },
        geometry: {
          width: viewport.width,
          height: viewport.height,
          rotation: page.rotate,
          transform: [a, b, c, d, e, f] as [number, number, number, number, number, number],
          viewBox: { x: page.view[0], y: page.view[1], w: page.view[2] - page.view[0], h: page.view[3] - page.view[1] },
          userUnit: page.userUnit ?? 1
        }
      };
    })
  );
  const pageSizes = pages.map((page) => page.size);
  const pageGeometry = pages.map((page) => page.geometry);

  return {
    docId: crypto.randomUUID(),
    fileName: file.name,
    pdfBytes,
    pageCount: pdf.numPages,
    pageSizes,
    pageGeometry,
    placements: [],
    status: 'pending'
  };
}

