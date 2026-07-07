import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { loadDocument, renderPage } from '../pdf/render';
import { getSamplePdfBytes } from '../lib/samplePdf';

type PdfScratchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; pageCount: number }
  | { status: 'error'; message: string };

export function PdfScratch() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<PdfScratchState>({ status: 'idle' });

  useEffect(() => {
    if (state.status !== 'ready') return;

    let cancelled = false;
    async function draw() {
      try {
        const bytes = await getSamplePdfBytes();
        const pdf = await loadDocument(bytes);
        if (cancelled || !canvasRef.current) return;
        await renderPage(pdf, 0, 1.2, canvasRef.current);
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not render the sample PDF.'
          });
        }
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [state.status]);

  const handleLoad = async () => {
    setState({ status: 'loading' });
    try {
      const bytes = await getSamplePdfBytes();
      const pdf = await loadDocument(bytes);
      setState({ status: 'ready', pageCount: pdf.numPages });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load the sample PDF.'
      });
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">pdf.js scratch view</h2>
          <p className="mt-1 text-sm text-quiet">
            Verifies bundled worker, cmaps, and fonts by rendering a local sample document.
          </p>
        </div>
        <Button variant="secondary" onClick={handleLoad} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading sample…' : 'Render sample PDF'}
        </Button>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-mist p-4">
        {state.status === 'idle' && (
          <p className="text-sm text-quiet">Load the sample PDF to verify local rendering.</p>
        )}
        {state.status === 'error' && <p className="text-sm text-red-700">{state.message}</p>}
        {state.status === 'ready' && (
          <div className="space-y-3">
            <p className="text-sm text-quiet">Loaded {state.pageCount} page sample from local bytes.</p>
            <div className="overflow-auto rounded-xl bg-white p-3">
              <canvas ref={canvasRef} className="mx-auto block max-w-full rounded-lg shadow-sm" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
