import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageGeometry } from './coords';
import { getPdfJsRuntime } from './runtime';

export type LoadedPdf = PDFDocumentProxy;

const thumbnailCache = new Map<string, Promise<ImageBitmap>>();

/**
 * Captures the serializable scale-1 viewport geometry for every page. The
 * transform maps PDF user space into viewport points and includes UserUnit,
 * so the exporter can invert it without re-opening the PDF.
 */
export async function capturePageGeometry(pdf: LoadedPdf): Promise<PageGeometry[]> {
  const geometries: PageGeometry[] = [];
  for (let index = 0; index < pdf.numPages; index++) {
    const page = await pdf.getPage(index + 1);
    const viewport = page.getViewport({ scale: 1 });
    const [a, b, c, d, e, f] = viewport.transform;
    geometries.push({
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate,
      transform: [a, b, c, d, e, f],
      viewBox: { x: page.view[0], y: page.view[1], w: page.view[2] - page.view[0], h: page.view[3] - page.view[1] },
      userUnit: page.userUnit ?? 1
    });
  }
  return geometries;
}

export class SignlitePdfError extends Error {
  constructor(public code: 'encrypted' | 'corrupt') {
    super(code);
  }
}

export async function loadDocument(bytes: ArrayBuffer): Promise<LoadedPdf> {
  try {
    const { getDocument } = await getPdfJsRuntime();
    const task = getDocument({
      data: bytes,
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/standard_fonts/'
    });
    return await task.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('password') || message.includes('encrypted')) {
      throw new SignlitePdfError('encrypted');
    }
    throw new SignlitePdfError('corrupt');
  }
}

export async function renderPage(
  pdf: LoadedPdf,
  pageIndex: number,
  scale: number,
  canvas: HTMLCanvasElement
): Promise<void> {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
}

export async function renderThumbnail(pdf: LoadedPdf, pageIndex: number, cacheKey?: string): Promise<ImageBitmap> {
  const resolvedKey = cacheKey ?? `${pdf.fingerprints[0] ?? 'pdf'}:${pageIndex}`;
  const cached = thumbnailCache.get(resolvedKey);
  if (cached) {
    return cached;
  }

  const renderPromise = (async () => {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = 120 / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
    page.cleanup();
    return createImageBitmap(canvas);
  })();

  thumbnailCache.set(resolvedKey, renderPromise);
  return renderPromise;
}
