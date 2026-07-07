import { useEffect, useRef, useState } from 'react';
import type { LoadedPdf } from '../../pdf/render';
import { renderThumbnail } from '../../pdf/render';
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
  onSelectPage: (pageIndex: number) => void;
};

function ThumbnailItem({ pdf, documentId, pageIndex, isActive, onSelectPage }: ThumbnailItemProps) {
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
        const bitmap = await renderThumbnail(loadedPdf, pageIndex, `${documentId}:${pageIndex}`);
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
  }, [documentId, pageIndex, pdf]);

  return (
    <button
      className={`focus-ring w-full border p-2 text-left transition ${isActive ? 'border-accent bg-accent-subtle' : 'border-line bg-surface hover:bg-mist'}`}
      onClick={() => onSelectPage(pageIndex)}
      type="button"
    >
      <div className="text-caption font-medium uppercase text-quiet">{STRINGS.editor.pageLabel(pageIndex + 1)}</div>
      <div className="mt-2 overflow-hidden border border-line bg-mist">
        {error ? (
          <div className="flex h-36 items-center justify-center text-caption text-quiet">{STRINGS.editor.pagePreviewUnavailable}</div>
        ) : isLoading ? (
          <div className="flex h-36 flex-col items-center justify-center gap-2 px-3">
            <div className="skeleton-block h-24 w-full" />
            <span className="text-caption text-quiet">{STRINGS.loading.thumbnail}</span>
          </div>
        ) : (
          <canvas ref={canvasRef} className="block h-auto w-full" />
        )}
      </div>
    </button>
  );
}

export function PageThumbnails({ pdf, documentId, pageCount, activePage, onSelectPage }: PageThumbnailsProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: pageCount }, (_, pageIndex) => (
        <ThumbnailItem
          key={pageIndex}
          pdf={pdf}
          documentId={documentId}
          pageIndex={pageIndex}
          isActive={activePage === pageIndex}
          onSelectPage={onSelectPage}
        />
      ))}
    </div>
  );
}
