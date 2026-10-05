let pdfJsRuntimePromise: Promise<{ getDocument: typeof import('pdfjs-dist').getDocument }> | null = null;

function preloadWorker(workerUrl: string) {
  if (typeof document === 'undefined' || document.querySelector(`link[data-signlite-pdf-worker="${workerUrl}"]`)) {
    return;
  }

  const preload = document.createElement('link');
  preload.rel = 'modulepreload';
  preload.href = workerUrl;
  preload.setAttribute('data-signlite-pdf-worker', workerUrl);
  document.head.appendChild(preload);
}

export async function getPdfJsRuntime() {
  if (!pdfJsRuntimePromise) {
    pdfJsRuntimePromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjs, workerModule]) => {
        const workerUrl = workerModule.default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        preloadWorker(workerUrl);
        return { getDocument: pdfjs.getDocument };
      }
    );
  }

  return pdfJsRuntimePromise;
}

export type RuntimeState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string };

type Listener = () => void;

let state: RuntimeState = { status: 'loading' };
const listeners = new Set<Listener>();

function setState(next: RuntimeState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Observes readiness for React via useSyncExternalStore. */
export function subscribeRuntime(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRuntimeState(): RuntimeState {
  return state;
}

/** The resident flatten worker. One instance serves every batch attempt;
 *  a crash withdraws it and the next attempt rebuilds it from resident bytes. */
type ResidentFlattenWorker = {
  worker: Worker;
  ready: Promise<void>;
};

let flattenWorker: ResidentFlattenWorker | null = null;
let readiness: Promise<void> | null = null;

function spawnFlattenWorker(): ResidentFlattenWorker {
  const worker = new Worker(new URL('../workers/flatten.worker.ts', import.meta.url), { type: 'module' });
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Flatten worker did not answer its handshake')), 15000);
    worker.onmessage = (event: MessageEvent<{ kind: string }>) => {
      if (event.data?.kind === 'pong') {
        window.clearTimeout(timeout);
        resolve();
      }
    };
    worker.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Flatten worker failed during its handshake'));
    };
    worker.postMessage({ kind: 'ping' });
  });
  worker.addEventListener('error', () => {
    // A crashed resident worker must not be handed to the next batch; the
    // next attempt spawns a fresh one from the already-loaded bundle.
    if (flattenWorker?.worker === worker) flattenWorker = null;
  });
  return { worker, ready };
}

/** Hands the resident flatten worker to a caller. Rebuilds it from the
 *  already-loaded bundle when a previous instance crashed. */
export async function acquireFlattenWorker(): Promise<Worker> {
  if (!flattenWorker) {
    flattenWorker = spawnFlattenWorker();
  }
  const resident = flattenWorker;
  await resident.ready;
  return resident.worker;
}

let pdfWorkerBlobUrl: string | null = null;
let pdfjsModule: typeof import('pdfjs-dist') | null = null;

/** Builds one Worker from the resident bundle. Callers get an isolated worker
 *  whose lifetime pdf.js owns: pdf.js's loadingTask.destroy() terminates
 *  whichever worker served the document, so a worker shared across documents
 *  would die with the first one. The blob source keeps that lifecycle zero
 *  HTTP — the CSP's `connect-src 'none'` bans fetches, and worker-src allows
 *  blob:. */
export function createPdfWorkerPort(): Worker {
  if (!pdfWorkerBlobUrl) {
    throw new Error('PDF worker source is not resident; readiness has not completed');
  }
  return new Worker(pdfWorkerBlobUrl, { type: 'module' });
}

/** Points pdf.js at a fresh worker for the next getDocument. Synchronous on
 *  purpose: loadDocument calls it immediately before getDocument, and an async
 *  setter would race it onto the previous, possibly destroyed, port. */
export function setFreshPdfWorkerPort() {
  // A no-op before readiness: only tests load documents without it, and they
  // exercise the task lifecycle, not worker provenance.
  if (!pdfjsModule) return;
  pdfjsModule.GlobalWorkerOptions.workerPort = createPdfWorkerPort();
}

async function startPdfWorker(): Promise<void> {
  const [pdfjs, { pdfWorkerSource }] = await Promise.all([
    import('pdfjs-dist'),
    import('./workerSource')
  ]);
  pdfjsModule = pdfjs;
  const blob = new Blob([pdfWorkerSource], { type: 'text/javascript' });
  pdfWorkerBlobUrl = URL.createObjectURL(blob);
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
  // Each document is assigned a fresh port in loadDocument; the warm parse
  // below exercises the same path before any user document depends on it.
  pdfjs.GlobalWorkerOptions.workerPort = createPdfWorkerPort();
}

/** One tiny parse on the real worker: proves it starts, answers, and can read
 *  resident bytes before any user document depends on it. */
async function warmPdfWorker(): Promise<void> {
  const { getDocument } = await getPdfJsRuntime();
  const { getProbePdfBytes } = await import('./probePdf');
  const task = getDocument({ data: getProbePdfBytes() });
  const pdf = await task.promise;
  await pdf.destroy();
}

/** Loads every module, data asset, and worker the signing flow can need, and
 *  resolves only when both workers have answered a handshake. After this
 *  resolves, signing to a completed download issues no HTTP request. */
export function ensureRuntimeReady(): Promise<void> {
  readiness ??= (async () => {
    try {
      // Resident data assets (CMaps, standard fonts) register on import; the
      // editor module must be resident before intake can open it.
      await Promise.all([
        import('./generated/pdfAssets'),
        import('../components/editor/EditorView'),
        import('./flatten'),
        // The pdf.js auxiliary-data factories ride with the data table.
        import('./assetFactories')
      ]);
      await startPdfWorker();
      await Promise.all([warmPdfWorker(), acquireFlattenWorker()]);
      setState({ status: 'ready' });
    } catch (error) {
      readiness = null;
      flattenWorker = null;
      setState({ status: 'failed', message: error instanceof Error ? error.message : 'Runtime failed to prepare' });
      throw error;
    }
  })();
  return readiness;
}

/** Retry after a failed preflight, by reloading. A failed preparation leaves
 *  the document poisoned: Chromium caches failed dynamic-import results for
 *  the document's lifetime, so an in-place retry of the same modules cannot
 *  succeed. Nothing user-facing exists yet (intake is gated on readiness), so
 *  a reload is free. */
export function retryRuntime(): void {
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
