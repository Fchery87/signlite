import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDocument, releaseThumbnails, renderThumbnail, SignlitePdfError, startPageRender } from '../../src/pdf/render';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal PDFDocumentProxy double. Entries in `renderTasks` are settled by the
 *  test so cancellation and ordering are observable; with none supplied a render
 *  completes immediately, which keeps the two-slot thumbnail scheduler draining. */
function fakePdf(options: { pageCount?: number; renderTasks?: Array<Deferred<void>> } = {}) {
  const pageCount = options.pageCount ?? 1;
  const renderTasks = [...(options.renderTasks ?? [])];
  const cleanup = vi.fn();
  const pages = Array.from({ length: pageCount }, () => ({
    rotate: 0,
    view: [0, 0, 612, 792],
    userUnit: 1,
    cleanup,
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, transform: [1, 0, 0, -1, 0, 0] }),
    render: vi.fn(() => {
      const supplied = renderTasks.shift();
      const task: Deferred<void> = supplied ?? { promise: Promise.resolve(), resolve: () => undefined, reject: () => undefined };
      return { promise: task.promise, cancel: vi.fn(() => task.resolve()) };
    })
  }));
  return { numPages: pageCount, fingerprints: ['fp'], getPage: vi.fn(async (n: number) => pages[n - 1]), destroy: vi.fn(async () => undefined) };
}

function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = (() => ({
    setTransform: () => {},
    clearRect: () => {},
    drawImage: () => {},
    set fillStyle(_: string) {},
    set font(_: string) {},
    set textBaseline(_: string) {}
  })) as unknown as HTMLCanvasElement['getContext'];
}

describe('loadDocument releases a loading task that never produced a proxy', () => {
  it('destroys the task when the parse fails, then reports corrupt', async () => {
    const destroy = vi.fn(async () => undefined);
    const pending = deferred<never>();
    const task = { promise: pending.promise, destroy };
    const { getPdfJsRuntime } = await import('../../src/pdf/runtime');
    vi.spyOn(await import('../../src/pdf/runtime'), 'getPdfJsRuntime').mockResolvedValue({
      getDocument: vi.fn(() => {
        queueMicrotask(() => pending.reject(new Error('Invalid PDF structure')));
        return task;
      }) as never
    });
    expect(getPdfJsRuntime).toBeDefined();

    await expect(loadDocument(new ArrayBuffer(4))).rejects.toBeInstanceOf(SignlitePdfError);
    // A rejected parse must not retain the worker slot and document handle.
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('reports encrypted separately and still destroys the task', async () => {
    const destroy = vi.fn(async () => undefined);
    const pending = deferred<never>();
    const task = { promise: pending.promise, destroy };
    vi.spyOn(await import('../../src/pdf/runtime'), 'getPdfJsRuntime').mockResolvedValue({
      getDocument: vi.fn(() => {
        queueMicrotask(() => pending.reject(new Error('Password required')));
        return task;
      }) as never
    });

    await expect(loadDocument(new ArrayBuffer(4))).rejects.toMatchObject({ code: 'encrypted' });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('startPageRender ownership', () => {
  beforeEach(() => stubCanvas());

  it('cancels the render task and waits for the canvas to be released', async () => {
    const task = deferred<void>();
    const pdf = fakePdf({ renderTasks: [task] });
    const canvas = document.createElement('canvas');
    const render = startPageRender(pdf as never, 0, 1, canvas);

    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalled());
    await render.cancel();
    // Settlement was awaited, so the canvas is free for the next render.
    await expect(render.finished).resolves.toBeUndefined();
  });

  it('treats cancellation as an expected outcome rather than a render failure', async () => {
    const pdf = fakePdf({ renderTasks: [deferred<void>()] });
    const canvas = document.createElement('canvas');
    const render = startPageRender(pdf as never, 0, 1, canvas);

    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalled());
    const rejection = render.finished.then(
      () => 'resolved',
      (error) => `rejected: ${String(error)}`
    );
    await render.cancel();

    // pdf.js rejects a cancelled render; that rejection must not reach the UI.
    await expect(rejection).resolves.toBe('resolved');
  });

  it('surfaces a genuine render failure to the caller', async () => {
    const failing = deferred<void>();
    failing.reject(new Error('boom'));
    const pdf = fakePdf({ renderTasks: [failing] });
    const canvas = document.createElement('canvas');
    const render = startPageRender(pdf as never, 0, 1, canvas);

    await expect(render.finished).rejects.toThrow('boom');
  });

  it('releases the page when cancelled before the render task exists', async () => {
    const pdf = fakePdf();
    const canvas = document.createElement('canvas');
    const render = startPageRender(pdf as never, 0, 1, canvas);

    await render.cancel();
    await expect(render.finished).resolves.toBeUndefined();
  });
});

describe('thumbnail retention', () => {
  const closed: Array<{ close: ReturnType<typeof vi.fn> }> = [];

  beforeEach(() => {
    closed.length = 0;
    stubCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      const bitmap = { width: 120, height: 160, close: vi.fn() };
      closed.push(bitmap);
      return bitmap;
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await releaseThumbnails('doc-a');
  });

  it('caches per document so a second request reuses the bitmap', async () => {
    const pdf = fakePdf();
    const first = await renderThumbnail(pdf as never, 0, { documentId: 'doc-a' });
    const second = await renderThumbnail(pdf as never, 0, { documentId: 'doc-a' });

    expect(second).toBe(first);
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
  });

  it('removes a rejected entry so a retry can succeed', async () => {
    const failing = deferred<void>();
    failing.reject(new Error('render failed'));
    const failingPdf = fakePdf({ renderTasks: [failing] });

    await expect(renderThumbnail(failingPdf as never, 0, { documentId: 'doc-a' })).rejects.toThrow('render failed');
    // The failure must not stay cached, or Retry would return the same rejection.
    const recovered = await renderThumbnail(fakePdf() as never, 0, { documentId: 'doc-a' });
    expect(recovered.width).toBe(120);
  });

  it('closes every retained bitmap when the document is released', async () => {
    const pdf = fakePdf({ pageCount: 3 });
    await Promise.all([
      renderThumbnail(pdf as never, 0, { documentId: 'doc-a' }),
      renderThumbnail(pdf as never, 1, { documentId: 'doc-a' }),
      renderThumbnail(pdf as never, 2, { documentId: 'doc-a' })
    ]);
    expect(closed).toHaveLength(3);

    await releaseThumbnails('doc-a');
    expect(closed.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it('bounds retention per document and closes what it evicts', async () => {
    const pdf = fakePdf({ pageCount: 40 });
    await Promise.all(
      Array.from({ length: 40 }, (_, page) => renderThumbnail(pdf as never, page, { documentId: 'doc-a' }))
    );

    // 40 pages requested, but retention is bounded, so bitmaps were closed on the way out.
    const closedCount = closed.filter((bitmap) => bitmap.close.mock.calls.length > 0).length;
    expect(closedCount).toBeGreaterThan(0);
    expect(closedCount).toBeLessThan(40);
  });

  it('scopes caches per document so one document cannot serve another bitmaps', async () => {
    const docA = fakePdf();
    const docB = fakePdf();
    const a = await renderThumbnail(docA as never, 0, { documentId: 'doc-a' });
    const b = await renderThumbnail(docB as never, 0, { documentId: 'doc-b' });

    expect(a).not.toBe(b);
  });

  it('runs at most two thumbnail renders at a time', async () => {
    const tasks = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const pdf = fakePdf({ pageCount: 4, renderTasks: tasks });
    const requests = [0, 1, 2, 3].map((page) => renderThumbnail(pdf as never, page, { documentId: 'doc-a' }));

    // Only two slots exist, so the third and fourth wait rather than piling on.
    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(2));

    tasks[0]!.resolve();
    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(3));

    tasks.slice(1).forEach((task) => task.resolve());
    await Promise.all(requests);
  });

  it('frees a thumbnail slot when a render settles', async () => {
    const tasks = [deferred<void>(), deferred<void>(), deferred<void>()];
    const pdf = fakePdf({ pageCount: 3, renderTasks: tasks });
    const requests = [0, 1, 2].map((page) => renderThumbnail(pdf as never, page, { documentId: 'doc-a' }));

    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(2));
    tasks[0]!.reject(new Error('first slot failed'));
    tasks[1]!.resolve();
    tasks[2]!.resolve();

    // A failed render must still hand its slot back, or the queue stalls forever.
    await Promise.allSettled(requests);
    expect(pdf.getPage).toHaveBeenCalledTimes(3);
  });

  it('runs the visible page ahead of a distant one when a slot frees', async () => {
    const tasks = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const pdf = fakePdf({ pageCount: 4, renderTasks: tasks });
    const busy = [
      renderThumbnail(pdf as never, 0, { documentId: 'doc-a', priority: 0 }),
      renderThumbnail(pdf as never, 1, { documentId: 'doc-a', priority: 1 })
    ];
    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(2));

    // Queued worst-first, so only priority ordering can put the active page next.
    const distant = renderThumbnail(pdf as never, 3, { documentId: 'doc-a', priority: 9 });
    const active = renderThumbnail(pdf as never, 2, { documentId: 'doc-a', priority: 0 });
    tasks[0]!.resolve();

    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(3));
    expect(pdf.getPage).toHaveBeenLastCalledWith(3);

    tasks.slice(1).forEach((task) => task.resolve());
    await Promise.all([...busy, distant, active]);
  });
});