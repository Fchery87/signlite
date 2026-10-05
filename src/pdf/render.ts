import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { PageGeometry } from './coords';
import { getPdfJsRuntime } from './runtime';

export type LoadedPdf = PDFDocumentProxy;

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
    page.cleanup();
  }
  return geometries;
}

export class SignlitePdfError extends Error {
  constructor(public code: 'encrypted' | 'corrupt') {
    super(code);
  }
}

export async function loadDocument(bytes: ArrayBuffer): Promise<LoadedPdf> {
  let task: { promise: Promise<LoadedPdf>; destroy: () => Promise<unknown> } | null = null;
  try {
    const { getDocument } = await getPdfJsRuntime();
    task = getDocument({
      data: bytes,
      // Auxiliary data comes from the resident bundle; no render-time fetches.
      // The factories live behind a dynamic import so the 2.6 MB data table
      // stays out of the entry chunk: render.ts is reachable from the session
      // store, and a static import here would drag the table into every load.
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      useWorkerFetch: false,
      CMapReaderFactory: (await import('./assetFactories')).BundledCMapReaderFactory as never,
      StandardFontDataFactory: (await import('./assetFactories')).BundledStandardFontDataFactory as never,
      standardFontDataUrl: '/standard_fonts/'
    });
    return await task.promise;
  } catch (error) {
    // A load that never produced a proxy still owns a worker slot and document
    // handle. Destroying the task releases them; a failed parse must not retain
    // either for the life of the tab.
    await task?.destroy().catch(() => undefined);
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('password') || message.includes('encrypted')) {
      throw new SignlitePdfError('encrypted');
    }
    throw new SignlitePdfError('corrupt');
  }
}

/** A page render in flight. `finished` settles once the canvas is no longer
 *  being written to, whether the render completed or was cancelled. */
export type PageRender = {
  finished: Promise<void>;
  /** Cancels the render and waits until the canvas has been released, so a new
   *  render never writes into a canvas the cancelled one still owns. */
  cancel: () => Promise<void>;
};

export function startPageRender(
  pdf: LoadedPdf,
  pageIndex: number,
  scale: number,
  canvas: HTMLCanvasElement
): PageRender {
  let task: RenderTask | null = null;
  let cancelled = false;

  const finished = (async () => {
    const page = await pdf.getPage(pageIndex + 1);
    if (cancelled) {
      page.cleanup();
      return;
    }
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext('2d');
    if (!context) {
      page.cleanup();
      return;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    task = page.render({ canvasContext: context, viewport });
    try {
      await task.promise;
    } catch (error) {
      // Scrolling or zooming away cancels the render, and pdf.js rejects that
      // cancellation. It is the expected outcome, not a failure to surface.
      if (!cancelled) throw error;
    } finally {
      page.cleanup();
    }
  })();

  const cancel = async () => {
    cancelled = true;
    if (task) {
      try {
        await task.cancel();
      } catch {
        // Already settled; nothing left to release.
      }
    }
    await finished.catch(() => undefined);
  };

  return { finished, cancel };
}

/** Thumbnails are retained per document with a bounded least-recently-used
 *  budget, so switching documents or scrolling a long one cannot grow retained
 *  memory without limit. */
const THUMBNAIL_CACHE_LIMIT = 24;
const MAX_CONCURRENT_THUMBNAILS = 2;

type ThumbnailEntry = {
  promise: Promise<ImageBitmap>;
  /** Monotonic stamp for least-recently-used eviction within a document. */
  touched: number;
};

const thumbnailCaches = new Map<string, Map<number, ThumbnailEntry>>();

type ScheduledRequest = { priority: number; run: () => void };
const pendingThumbnails: ScheduledRequest[] = [];
let inFlightThumbnails = 0;
let useStamp = 0;

function pumpThumbnailQueue() {
  while (inFlightThumbnails < MAX_CONCURRENT_THUMBNAILS && pendingThumbnails.length > 0) {
    const next = pendingThumbnails.shift();
    if (!next) return;
    inFlightThumbnails += 1;
    next.run();
  }
}

/** Runs `work` once a thumbnail slot is free. Lower priority runs first, so
 *  visible and nearby pages are not stuck behind a long document's tail. */
function scheduleThumbnail<T>(priority: number, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingThumbnails.push({
      priority,
      run: () => {
        work().then(resolve, reject).finally(() => {
          inFlightThumbnails -= 1;
          pumpThumbnailQueue();
        });
      }
    });
    pendingThumbnails.sort((a, b) => a.priority - b.priority);
    pumpThumbnailQueue();
  });
}

function evictThumbnails(cache: Map<number, ThumbnailEntry>) {
  while (cache.size > THUMBNAIL_CACHE_LIMIT) {
    let oldestPage = -1;
    let oldestStamp = Infinity;
    for (const [page, entry] of cache) {
      if (entry.touched < oldestStamp) {
        oldestStamp = entry.touched;
        oldestPage = page;
      }
    }
    if (oldestPage === -1) return;
    const evicted = cache.get(oldestPage);
    cache.delete(oldestPage);
    void evicted?.promise.then((bitmap) => bitmap.close()).catch(() => undefined);
  }
}

/** Closes and forgets every thumbnail retained for a document. Call this when
 *  the document is closed, replaced, or the editor unmounts. */
export async function releaseThumbnails(documentId: string): Promise<void> {
  const cache = thumbnailCaches.get(documentId);
  if (!cache) return;
  thumbnailCaches.delete(documentId);
  await Promise.all(
    Array.from(cache.values()).map((entry) => entry.promise.then((bitmap) => bitmap.close()).catch(() => undefined))
  );
}

export async function renderThumbnail(
  pdf: LoadedPdf,
  pageIndex: number,
  options: { documentId?: string; cacheKey?: string; priority?: number } = {}
): Promise<ImageBitmap> {
  const documentId = options.documentId ?? pdf.fingerprints[0] ?? 'pdf';
  let cache = thumbnailCaches.get(documentId);
  if (!cache) {
    cache = new Map();
    thumbnailCaches.set(documentId, cache);
  }
  const cached = cache.get(pageIndex);
  if (cached) {
    cached.touched = (useStamp += 1);
    return cached.promise;
  }

  const renderPromise = scheduleThumbnail(options.priority ?? pageIndex, async () => {
    const page = await pdf.getPage(pageIndex + 1);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const scaledViewport = page.getViewport({ scale: 120 / viewport.width });
      const canvas = document.createElement('canvas');
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2d context unavailable');
      await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
      return createImageBitmap(canvas);
    } finally {
      page.cleanup();
    }
  });

  const entry: ThumbnailEntry = { promise: renderPromise, touched: (useStamp += 1) };
  cache.set(pageIndex, entry);

  // A rejected promise must not stay cached, or a retry after a transient
  // failure would keep returning the same rejection forever.
  renderPromise.catch(() => {
    if (cache?.get(pageIndex) === entry) cache.delete(pageIndex);
  });
  evictThumbnails(cache);
  return renderPromise;
}