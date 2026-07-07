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
