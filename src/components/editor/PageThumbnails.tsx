import { useEffect, useRef, useState } from 'react';
import type { LoadedPdf } from '../../pdf/render';
import { releaseThumbnails, renderThumbnail } from '../../pdf/render';
import { STRINGS } from '../../lib/strings';

type PageThumbnailsProps = {
  pdf: LoadedPdf | null;
  documentId: string;
  pageCount: number;
  activePage: number;
  onSelectPage: (pageIndex: number) => void;
};

type ThumbnailItemProps = {
  pdf: LoadedPdf | null;
  documentId: string;
  pageIndex: number;
  isActive: boolean;
  priority: number;
  onSelectPage: (pageIndex: number) => void;
};

function ThumbnailItem({ pdf, documentId, pageIndex, isActive, priority, onSelectPage }: ThumbnailItemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!pdf) {
      setIsLoading(true);
      return;
    }

    const loadedPdf = pdf;
    let cancelled = false;

    async function draw() {
      try {
        setIsLoading(true);
        const bitmap = await renderThumbnail(loadedPdf, pageIndex, { documentId, priority });
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        setError(false);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setIsLoading(false);
        }
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [documentId, pageIndex, pdf, priority]);

  return (
    <button
      className={`focus-ring w-full rounded-md border p-2 text-left transition-colors ${isActive ? 'border-ink bg-accent-subtle' : 'border-transparent bg-mist/50 hover:border-line hover:bg-mist'}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onSelectPage(pageIndex)}
      type="button"
    >
      <div className="flex items-center justify-between text-caption font-medium text-ink">
        <span>{STRINGS.editor.pageLabel(pageIndex + 1)}</span>
        {isActive ? <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" /> : null}
      </div>
      <div className="relative mx-auto mt-2 min-h-28 max-w-[120px] overflow-hidden rounded-sm border border-line bg-surface shadow-page">
        {error ? (
          <div className="flex h-28 items-center justify-center px-2 text-center text-caption text-quiet">{STRINGS.editor.pagePreviewUnavailable}</div>
        ) : (
          <>
            {/* The canvas stays mounted so the draw effect can reach it; the
                skeleton covers it until the first paint lands. */}
            <canvas ref={canvasRef} className="block h-auto w-full" />
            {isLoading && (
              <div className="absolute inset-0 flex min-h-28 flex-col items-center justify-center gap-2 bg-mist px-3">
                <div className="skeleton-block h-24 w-full" />
                <span className="text-caption text-quiet">{STRINGS.loading.thumbnail}</span>
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}

export function PageThumbnails({ pdf, documentId, pageCount, activePage, onSelectPage }: PageThumbnailsProps) {
  // Thumbnails render at most two at a time, so the visible page and its
  // neighbours must reach the scheduler first or a long document's tail starves.
  const priorityFor = (pageIndex: number) => Math.abs(pageIndex - activePage);

  useEffect(() => {
    if (!documentId) return;
    // Retained bitmaps belong to the document, not to this component instance,
    // so leaving the document or unmounting must close them.
    return () => {
      void releaseThumbnails(documentId);
    };
  }, [documentId]);

  return (
    <div className="space-y-3">
      {Array.from({ length: pageCount }, (_, pageIndex) => (
        <ThumbnailItem
          key={pageIndex}
          pdf={pdf}
          documentId={documentId}
          pageIndex={pageIndex}
          isActive={activePage === pageIndex}
          priority={priorityFor(pageIndex)}
          onSelectPage={onSelectPage}
        />
      ))}
    </div>
  );
}
