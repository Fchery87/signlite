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

export type FileValidationError = 'pdf-only' | 'too-large' | 'session-limit' | 'session-page-limit' | 'encrypted' | 'corrupt';

type CreateSessionDocumentOptions = {
  currentPageCount?: number;
  acceptedPageCount?: number;
};

class SessionPageLimitError extends Error {
  constructor() {
    super('session-page-limit');
  }
}

export function getFileValidationError(file: File, currentCount: number, acceptedCount: number): FileValidationError | null {
  if (file.type !== 'application/pdf') return 'pdf-only';
  if (file.size > MAX_FILE_SIZE) return 'too-large';
  if (currentCount + acceptedCount >= MAX_SESSION_FILES) return 'session-limit';
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

  const pageSizes = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      return { w: viewport.width, h: viewport.height };
    })
  );

  return {
    docId: crypto.randomUUID(),
    fileName: file.name,
    pdfBytes,
    pageCount: pdf.numPages,
    pageSizes,
    placements: [],
    status: 'pending'
  };
}

