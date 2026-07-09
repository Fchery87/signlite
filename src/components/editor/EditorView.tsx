import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '../ui';
import { BatchPanel } from '../batch/BatchPanel';
import { ApplyToAll } from '../batch/ApplyToAll';
import { useSessionStore } from '../../stores/session';
import { STRINGS } from '../../lib/strings';
import { loadDocument, type LoadedPdf } from '../../pdf/render';
import { PageCanvas } from './PageCanvas';
import { PageThumbnails } from './PageThumbnails';
import { LibraryTray } from '../library/LibraryTray';
import { getDateFormat, hydrateSignaturePrefs } from '../../db/signatures';
import { downloadBlob, signedPdfFileName } from '../../lib/files';
import type { SignatureAsset } from '../../db/schema';

type ZoomOption = 'fit' | 1 | 1.5;

type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: LoadedPdf }
  | { status: 'error'; message: string };

const zoomOptions: { value: ZoomOption; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: 1, label: '100%' },
  { value: 1.5, label: '150%' }
];

const MIN_PLACEMENT_HEIGHT = 0.08;

const shortcutRows = [
  { key: 'Cmd/Ctrl+S', action: STRINGS.shortcuts.currentDownload },
  { key: 'Cmd/Ctrl+Shift+S', action: STRINGS.shortcuts.batchDownload },
  { key: 'Delete', action: STRINGS.shortcuts.removeSelection },
  { key: 'Arrows', action: STRINGS.shortcuts.nudge },
  { key: 'Esc', action: STRINGS.shortcuts.clearSelection },
  { key: '?', action: STRINGS.shortcuts.open }
] as const;

type EditorViewProps = {
  onToast: (message: string) => void;
};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function placementLabel(type: SignatureAsset['kind'] | 'date' | 'text') {
  switch (type) {
    case 'initials':
      return 'Initials';
    case 'date':
      return 'Date';
    case 'text':
      return 'Text';
    default:
      return 'Signature';
  }
}

export function EditorView({ onToast }: EditorViewProps) {
  const documents = useSessionStore((state) => state.session.documents);
  const selectedDocumentId = useSessionStore((state) => state.selectedDocumentId);
  const selectedPlacementId = useSessionStore((state) => state.selectedPlacementId);
  const addPlacement = useSessionStore((state) => state.addPlacement);
  const setSelection = useSessionStore((state) => state.setSelection);
  const updateDocumentStatus = useSessionStore((state) => state.updateDocumentStatus);
  const removeDocument = useSessionStore((state) => state.removeDocument);
  const selectedDocument = documents.find((document) => document.docId === selectedDocumentId) ?? documents[0] ?? null;

  const [pdfState, setPdfState] = useState<PdfState>({ status: 'loading' });
  const [isDownloading, setIsDownloading] = useState(false);
  const [zoom, setZoom] = useState<ZoomOption>('fit');
  const [viewerWidth, setViewerWidth] = useState(0);
  const [visibility, setVisibility] = useState<Record<number, number>>({ 0: 1 });
  const [pinnedPage, setPinnedPage] = useState<number | null>(null);
  const [dateFormat, setDateFormat] = useState(() => getDateFormat());
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef<Record<number, HTMLDivElement | null>>({});

  // Key the load effect on docId + pdfBytes (both stable across placement edits)
  // rather than the document object, which the store recreates on every mutation.
  const selectedDocId = selectedDocument?.docId ?? null;
  const selectedPdfBytes = selectedDocument?.pdfBytes ?? null;

  useEffect(() => {
    if (!selectedDocId || !selectedPdfBytes) return;

    let cancelled = false;
    let loadedPdf: LoadedPdf | null = null;
    setPdfState({ status: 'loading' });

    async function load() {
      try {
        loadedPdf = await loadDocument(selectedPdfBytes!.slice(0));
        if (!cancelled) {
          setPdfState({ status: 'ready', pdf: loadedPdf });
        }
      } catch (error) {
        if (!cancelled) {
          setPdfState({
            status: 'error',
            message: error instanceof Error ? error.message : STRINGS.editor.pdfLoadFallback
          });
        }
      }
    }

    void load();
    setVisibility({ 0: 1 });
    setPinnedPage(null);
    setSelection(selectedDocId, null);

    return () => {
      cancelled = true;
      void loadedPdf?.destroy();
    };
  }, [selectedDocId, selectedPdfBytes, setSelection]);

  useEffect(() => {
    void hydrateSignaturePrefs().then(() => setDateFormat(getDateFormat()));
  }, []);

  useEffect(() => {
    void import('../../pdf/flatten');
  }, []);

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;

    const updateWidth = () => {
      setViewerWidth(element.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const fitScale = useMemo(() => {
    if (!selectedDocument || viewerWidth === 0) return 1;
    const widestPage = Math.max(...selectedDocument.pageSizes.map((page) => page.w));
    return Math.max(0.4, (viewerWidth - 32) / widestPage);
  }, [selectedDocument, viewerWidth]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  const visiblePage = useMemo(() => {
    const entries = Object.entries(visibility);
    if (entries.length === 0) return 0;
    return Number(entries.sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0);
  }, [visibility]);
  // A clicked thumbnail pins the placement target until scrolling arrives
  // there or the user scrolls manually.
  const activePage = pinnedPage ?? visiblePage;
  const hasPlacements = (selectedDocument?.placements.length ?? 0) > 0;

  useEffect(() => {
    if (pinnedPage !== null && visiblePage === pinnedPage) {
      setPinnedPage(null);
    }
  }, [pinnedPage, visiblePage]);

  useEffect(() => {
    const element = scrollRootRef.current;
    if (!element) return;

    const clearPin = () => setPinnedPage(null);
    element.addEventListener('wheel', clearPin, { passive: true });
    element.addEventListener('touchmove', clearPin, { passive: true });
    return () => {
      element.removeEventListener('wheel', clearPin);
      element.removeEventListener('touchmove', clearPin);
    };
  }, []);

  const handleVisibilityChange = useCallback((pageIndex: number, ratio: number) => {
    setVisibility((current) => ({ ...current, [pageIndex]: ratio }));
  }, []);

  const handlePageElement = useCallback((pageIndex: number, element: HTMLDivElement | null) => {
    pageElementsRef.current[pageIndex] = element;
  }, []);

  const handleSelectPage = useCallback((pageIndex: number) => {
    setPinnedPage(pageIndex);
    pageElementsRef.current[pageIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const announcePlacement = useCallback((type: SignatureAsset['kind'] | 'date' | 'text', pageIndex: number) => {
    setAnnouncement(STRINGS.announcements.placedOnPage(placementLabel(type), pageIndex + 1));
  }, []);

  const placeSpecialElement = useCallback(
    (type: 'date' | 'text') => {
      const pageSize = selectedDocument?.pageSizes[activePage];
      if (!selectedDocument || !pageSize) return;
      addPlacement(selectedDocument.docId, {
        id: crypto.randomUUID(),
        type,
        pageIndex: activePage,
        x: 0.1,
        y: 0.1,
        w: type === 'date' ? 0.25 : 0.3,
        h: type === 'date' ? 0.06 : MIN_PLACEMENT_HEIGHT,
        value: type === 'date' ? dateFormat : 'Text',
        fontSize: 12
      });
      announcePlacement(type, activePage);
      onToast(type === 'date' ? STRINGS.editor.dateAdded : STRINGS.editor.textAdded);
    },
    [activePage, addPlacement, announcePlacement, dateFormat, onToast, selectedDocument]
  );

  const handlePlaceAsset = useCallback(
    (asset: SignatureAsset) => {
      const pageSize = selectedDocument?.pageSizes[activePage];
      if (!selectedDocument || !pageSize) return;
      const width = 0.2;
      const height = Math.max(
        MIN_PLACEMENT_HEIGHT,
        Math.min(width * (asset.height / asset.width) * (pageSize.w / pageSize.h), 0.5)
      );

      addPlacement(selectedDocument.docId, {
        id: crypto.randomUUID(),
        type: asset.kind,
        assetId: asset.id,
        assetPngBytes: asset.pngBytes.slice(0),
        pageIndex: activePage,
        x: 0.1,
        y: 0.1,
        w: width,
        h: height
      });
      announcePlacement(asset.kind, activePage);
      onToast(STRINGS.announcements.placedOnPage(placementLabel(asset.kind), activePage + 1));
    },
    [activePage, addPlacement, announcePlacement, onToast, selectedDocument]
  );

  const handleDownload = useCallback(async () => {
    if (!selectedDocument || isDownloading) return;
    setIsDownloading(true);
    try {
      const { flattenDocument } = await import('../../pdf/flatten');
      const flattened = await flattenDocument(selectedDocument);
      const fileName = signedPdfFileName(selectedDocument.fileName);
      const pdfBytes = flattened.buffer.slice(flattened.byteOffset, flattened.byteOffset + flattened.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
      updateDocumentStatus(selectedDocument.docId, 'signed');
      onToast(STRINGS.editor.downloadSuccess(fileName));
    } catch (error) {
      onToast(error instanceof Error ? error.message : STRINGS.editor.downloadFailed);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, onToast, selectedDocument, updateDocumentStatus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const isPrimaryModifier = event.metaKey || event.ctrlKey;
      if (isPrimaryModifier && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('signlite:batch-download'));
        return;
      }

      if (isPrimaryModifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleDownload();
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        setShortcutOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDownload]);

  if (!selectedDocument) {
    return null;
  }

  return (
    <section className="min-h-[calc(100vh-73px)] p-4">
      <div aria-live="polite" aria-label={STRINGS.liveRegionLabel} className="sr-only-live">
        {announcement}
      </div>
      <div className="grid h-[calc(100vh-105px)] grid-cols-[280px_minmax(0,1fr)_320px] gap-4">
        <aside className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <BatchPanel />
          <div className="surface-card min-h-0 overflow-auto p-4 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-h2 text-ink">{STRINGS.editor.pagesTitle}</h2>
                <p className="mt-1 text-caption text-quiet">{STRINGS.editor.pagesTotal(selectedDocument.pageCount)}</p>
              </div>
            </div>
            <div className="mt-4">
              <PageThumbnails
                activePage={activePage}
                documentId={selectedDocument.docId}
                pageCount={selectedDocument.pageCount}
                pdf={pdfState.status === 'ready' ? pdfState.pdf : null}
                onSelectPage={handleSelectPage}
              />
            </div>
          </div>
        </aside>

        <main className="surface-card flex min-h-0 flex-col shadow-panel">
          <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h1 className="text-h1 text-ink">{selectedDocument.fileName}</h1>
              <p className="mt-1 text-body text-quiet">{STRINGS.editor.pageOf(activePage + 1, selectedDocument.pageCount)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShortcutOpen(true)}>
                ?
              </Button>
              {zoomOptions.map((option) => (
                <Button
                  key={option.label}
                  type="button"
                  variant={zoom === option.value ? 'primary' : 'secondary'}
                  onClick={() => setZoom(option.value)}
                >
                  {option.label}
                </Button>
              ))}
              <Button
                onClick={() => void handleDownload()}
                disabled={isDownloading || !hasPlacements}
                title={!hasPlacements ? STRINGS.tooltips.nothingPlacedYet : undefined}
              >
                {isDownloading ? STRINGS.editor.downloading : STRINGS.buttons.download}
              </Button>
            </div>
          </div>

          <div ref={scrollRootRef} className="min-h-0 overflow-auto bg-sunken px-6 py-6">
            <div ref={viewerRef} className="mx-auto max-w-full space-y-6">
              {pdfState.status === 'error' && (
                <div className="border border-danger/30 bg-danger/10 p-4 text-body text-danger">
                  <p>{pdfState.message}</p>
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => removeDocument(selectedDocument.docId)}>
                      {STRINGS.editor.removeFromSession}
                    </Button>
                  </div>
                </div>
              )}
              {pdfState.status !== 'error' &&
                selectedDocument.pageSizes.map((pageSize, pageIndex) => (
                  <PageCanvas
                    key={`${selectedDocument.docId}-${pageIndex}`}
                    pdf={pdfState.status === 'ready' ? pdfState.pdf : null}
                    documentId={selectedDocument.docId}
                    pageIndex={pageIndex}
                    pageSize={pageSize}
                    placements={selectedDocument.placements.filter((placement) => placement.pageIndex === pageIndex)}
                    scale={scale}
                    selectedPlacementId={selectedPlacementId}
                    scrollRootRef={scrollRootRef}
                    onVisibilityChange={handleVisibilityChange}
                    onPageElement={handlePageElement}
                    onToast={onToast}
                    loading={pdfState.status === 'loading'}
                    onAnnouncePlacement={announcePlacement}
                  />
                ))}
            </div>
          </div>
        </main>

        <aside className="flex min-h-0 flex-col gap-4 overflow-auto">
          <ApplyToAll onToast={onToast} />
          <div className="surface-card min-h-0 p-4 shadow-panel">
            <LibraryTray
              onToast={onToast}
              onAddDate={() => placeSpecialElement('date')}
              onAddText={() => placeSpecialElement('text')}
              onPlaceAsset={handlePlaceAsset}
              activePage={activePage}
            />
          </div>
        </aside>
      </div>
      <Modal open={shortcutOpen} title={STRINGS.shortcuts.open} onClose={() => setShortcutOpen(false)}>
        <div className="space-y-3">
          <p className="text-body text-quiet">{STRINGS.shortcuts.hint}</p>
          <dl className="space-y-2">
            {shortcutRows.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-4 border-b border-line pb-2 text-body">
                <dt className="font-medium text-ink">{row.action}</dt>
                <dd className="font-mono text-quiet">{row.key}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Modal>
    </section>
  );
}
