import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Placement } from '../../db/schema';
import type { LoadedPdf } from '../../pdf/render';
import { renderPage } from '../../pdf/render';
import { PlacementLayer } from './PlacementLayer';
import { STRINGS } from '../../lib/strings';

type PageCanvasProps = {
  pdf: LoadedPdf | null;
  documentId: string;
  pageIndex: number;
  pageSize: { w: number; h: number };
  placements: Placement[];
  scale: number;
  selectedPlacementId: string | null;
  scrollRootRef: RefObject<HTMLDivElement>;
  onVisibilityChange: (pageIndex: number, ratio: number) => void;
  onPageElement: (pageIndex: number, element: HTMLDivElement | null) => void;
  onToast?: (message: string) => void;
  loading?: boolean;
  onAnnouncePlacement?: (type: Placement['type'], pageIndex: number) => void;
};

export function PageCanvas({
  pdf,
  documentId,
  pageIndex,
  pageSize,
  placements,
  scale,
  selectedPlacementId,
  scrollRootRef,
  onVisibilityChange,
  onPageElement,
  onToast,
  loading = false,
  onAnnouncePlacement
}: PageCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [isRendering, setIsRendering] = useState(true);

  const frameStyle = useMemo(
    () => ({ width: `${pageSize.w * scale}px`, minHeight: `${pageSize.h * scale}px` }),
    [pageSize.h, pageSize.w, scale]
  );

  useEffect(() => {
    onPageElement(pageIndex, wrapperRef.current);
    return () => {
      onPageElement(pageIndex, null);
    };
  }, [onPageElement, pageIndex]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.intersectionRatio ?? 0;
        setIsNearViewport(entry?.isIntersecting ?? false);
        onVisibilityChange(pageIndex, ratio);
      },
      {
        root: scrollRootRef.current,
        rootMargin: '100% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
      }
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onVisibilityChange, pageIndex, scrollRootRef]);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const canvas = canvasElement;

    if (!pdf || loading) {
      setIsRendering(true);
      return;
    }

    if (!isNearViewport) {
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = '';
      canvas.style.height = '';
      setIsRendering(true);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const clearCanvas = () => {
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
    };

    const runDraw = () => {
      setIsRendering(true);
      void renderPage(pdf, pageIndex, scale, canvas).then(() => {
        if (cancelled) {
          clearCanvas();
          return;
        }
        setIsRendering(false);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(runDraw, { timeout: 120 });
    } else {
      timeoutId = window.setTimeout(runDraw, 32);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isNearViewport, loading, pageIndex, pdf, scale]);

  return (
    <div ref={wrapperRef} className="mx-auto w-full">
      <div className="mb-2 text-caption font-medium uppercase text-quiet">{STRINGS.editor.pageLabel(pageIndex + 1)}</div>
      <div className="relative flex items-center justify-center overflow-visible border border-line bg-surface shadow-page" style={frameStyle}>
        <canvas ref={canvasRef} className="block max-w-full" aria-hidden="true" />
        {(loading || isRendering) && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80">
            <div className="w-[70%] space-y-3">
              <div className="skeleton-block h-8" />
              <div className="skeleton-block h-8 w-5/6" />
              <p className="text-center text-caption text-quiet">{STRINGS.loading.page}</p>
            </div>
          </div>
        )}
        <PlacementLayer
          documentId={documentId}
          pageIndex={pageIndex}
          pageSize={pageSize}
          placements={placements}
          scale={scale}
          selectedPlacementId={selectedPlacementId}
          onToast={onToast}
          onAnnouncePlacement={onAnnouncePlacement}
        />
      </div>
    </div>
  );
}
