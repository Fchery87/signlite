import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, isAnyModalOpen } from '../ui';
import { selectEditingBlocked, useSessionStore } from '../../stores/session';
import { STRINGS } from '../../lib/strings';
import { EXPORT_POLICY_DISCLOSURE, VISUAL_SIGNATURE_DISCLOSURE } from '../../lib/productPolicy';
import { loadDocument, type LoadedPdf } from '../../pdf/render';
import { PageCanvas } from './PageCanvas';
import { PageThumbnails } from './PageThumbnails';
import { ElementsPanel } from './ElementsPanel';
import { EditorPanel } from './EditorPanel';
import { useActivePage } from './useActivePage';
import { useWideLayout } from './useWideLayout';
import { placementLabel } from '../../lib/placements';
import { LibraryTray } from '../library/LibraryTray';
import { getDateFormat, hydrateSignaturePrefs } from '../../db/signatures';
import { COMMIT_REFUSALS, createSessionDocument, downloadBlob, getFileValidationError, REJECTION_REASONS, signedPdfFileName } from '../../lib/files';
import type { SessionDocument, SignatureAsset } from '../../db/schema';

type ZoomOption = 'fit' | 'width' | 1 | 1.5;

type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: LoadedPdf }
  | { status: 'error'; message: string };

const zoomOptions: { value: ZoomOption; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: 'width', label: 'Width' },
  { value: 1, label: '100%' },
  { value: 1.5, label: '150%' }
];

const MIN_PLACEMENT_HEIGHT = 0.08;

/** Vertical space a page needs besides the page itself: its "Page N" label
 *  (caption line + margin) and the frame border. */
const PAGE_CHROME_HEIGHT = 28;

const shortcutRows = [
  { key: 'Cmd/Ctrl+S', action: STRINGS.shortcuts.currentDownload },
  { key: 'Cmd/Ctrl+C', action: STRINGS.shortcuts.copySelection },
  { key: 'Cmd/Ctrl+V', action: STRINGS.shortcuts.pasteOnPage },
  { key: 'Cmd/Ctrl+D', action: STRINGS.shortcuts.duplicateSelection },
  { key: 'Cmd/Ctrl+Z', action: STRINGS.shortcuts.undo },
  { key: 'Cmd/Ctrl+Y', action: STRINGS.shortcuts.redo },
  { key: 'Delete', action: STRINGS.shortcuts.removeSelection },
  { key: 'Arrows', action: STRINGS.shortcuts.nudge },
  { key: 'Esc', action: STRINGS.shortcuts.clearSelection },
  { key: '?', action: STRINGS.shortcuts.open }
] as const;

type EditorViewProps = {
  onToast: (message: string) => void;
  /** App identity and status, shown at the start of the editor's single top bar. */
  appBrand?: ReactNode;
  /** App-wide utilities (offline status, local data), shown at the end of the top bar. */
  appUtilities?: ReactNode;
};

/**
 * Undo glyph; `mirrored` flips it into the redo direction.
 * The explicit box and shrink-0 matter: as a flex child the SVG collapses to 0 width.
 */
function HistoryIcon({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[15px] w-[15px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M3.2 6.6h6.3a3.4 3.4 0 0 1 0 6.8H6.4" />
      <path d="M5.9 3.9 3.2 6.6l2.7 2.7" />
    </svg>
  );
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function EditorView({ onToast, appBrand, appUtilities }: EditorViewProps) {
  const documents = useSessionStore((state) => state.session.documents);
  const selectedDocumentId = useSessionStore((state) => state.selectedDocumentId);
  const selectedPlacementId = useSessionStore((state) => state.selectedPlacementId);
  const addTextPlacement = useSessionStore((state) => state.addTextPlacement);
  const addSignaturePlacement = useSessionStore((state) => state.addSignaturePlacement);
  const stampPlacementOnEveryPage = useSessionStore((state) => state.stampPlacementOnEveryPage);
  const storedSignatureSnapshots = useSessionStore((state) => state.session.signatureSnapshots);
  const signatureSnapshots = useMemo(() => storedSignatureSnapshots ?? {}, [storedSignatureSnapshots]);
  const pastePlacement = useSessionStore((state) => state.pastePlacement);
  const undo = useSessionStore((state) => state.undo);
  const redo = useSessionStore((state) => state.redo);
  const canUndo = useSessionStore((state) => state.history.past.length > 0);
  const canRedo = useSessionStore((state) => state.history.future.length > 0);
  const setSelection = useSessionStore((state) => state.setSelection);
  const transitionDocumentOutput = useSessionStore((state) => state.transitionDocumentOutput);
  const removeDocument = useSessionStore((state) => state.removeDocument);
  const addDocuments = useSessionStore((state) => state.addDocuments);
  const openQueue = useSessionStore((state) => state.openQueue);
  const openDocument = useSessionStore((state) => state.openDocument);
  const armedSignature = useSessionStore((state) => state.armedSignature);
  const disarmSignature = useSessionStore((state) => state.disarmSignature);
  const mutationLocked = useSessionStore(selectEditingBlocked);
  const sessionId = useSessionStore((state) => state.session.id);
  const selectedDocument = documents.find((document) => document.docId === selectedDocumentId) ?? documents[0] ?? null;

  const [pdfState, setPdfState] = useState<PdfState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomOption>('fit');
  const [viewerWidth, setViewerWidth] = useState(0);
  const [viewerHeight, setViewerHeight] = useState(0);
  const wide = useWideLayout();
  const [dateFormat, setDateFormat] = useState(() => getDateFormat());
  const [shortcutOpen, setShortcutOpen] = useState(false);
  // Narrow screens hide the sidebars behind toggles; desktop keeps them fixed.
  const [pagesOpen, setPagesOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const addPdfsRef = useRef<HTMLInputElement>(null);

  // Key the load effect on docId + pdfBytes (both stable across placement edits)
  // rather than the document object, which the store recreates on every mutation.
  const selectedDocId = selectedDocument?.docId ?? null;
  const selectedPdfBytes = selectedDocument?.pdfBytes ?? null;

  const { activePage, onVisibilityChange, onPageElement, selectPage } = useActivePage(scrollRootRef, selectedDocId);

  useEffect(() => {
    if (!selectedDocId || !selectedPdfBytes) return;
    const pdfBytes = selectedPdfBytes;

    let cancelled = false;
    let loadedPdf: LoadedPdf | null = null;
    setPdfState({ status: 'loading' });
    setDownloadError(null);

    async function load() {
      try {
        loadedPdf = await loadDocument(pdfBytes.slice(0));
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
    setSelection(selectedDocId, null);

    return () => {
      cancelled = true;
      void loadedPdf?.destroy();
    };
  }, [selectedDocId, selectedPdfBytes, setSelection, loadAttempt]);

  useEffect(() => {
    void hydrateSignaturePrefs().then(() => setDateFormat(getDateFormat()));
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

  useEffect(() => {
    const element = scrollRootRef.current;
    if (!element) return;

    const updateHeight = () => {
      const style = getComputedStyle(element);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      setViewerHeight(Math.max(0, element.clientHeight - padding));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const fitWidthScale = useMemo(() => {
    if (!selectedDocument || viewerWidth === 0) return 1;
    const widestPage = Math.max(...selectedDocument.pageSizes.map((page) => page.w));
    return Math.max(0.05, (viewerWidth - 2) / widestPage);
  }, [selectedDocument, viewerWidth]);

  // "Fit" shows a whole page: the smaller of the width fit and the height fit.
  const fitPageScale = useMemo(() => {
    if (!selectedDocument || viewerHeight <= PAGE_CHROME_HEIGHT) return fitWidthScale;
    const tallestPage = Math.max(...selectedDocument.pageSizes.map((page) => page.h));
    return Math.max(0.05, Math.min(fitWidthScale, (viewerHeight - PAGE_CHROME_HEIGHT) / tallestPage));
  }, [selectedDocument, viewerHeight, fitWidthScale]);

  const scale = zoom === 'fit' ? fitPageScale : zoom === 'width' ? fitWidthScale : zoom;
  const hasPlacements = (selectedDocument?.placements.length ?? 0) > 0;

  const announcePlacement = useCallback((type: SignatureAsset['kind'] | 'date' | 'text', pageIndex: number) => {
    setAnnouncement(STRINGS.announcements.placedOnPage(placementLabel(type), pageIndex + 1));
  }, []);

  const reportStamp = useCallback((label: string, result: { ok: boolean; added: number }) => {
    if (!result.ok) {
      onToast(STRINGS.editor.stampFailed);
      return;
    }
    onToast(result.added > 0 ? STRINGS.editor.stampedOnEveryPage(label, result.added) : STRINGS.editor.stampNoOtherPages);
  }, [onToast]);

  const placeSpecialElement = useCallback(
    (type: 'date' | 'text', stamp = false) => {
      const pageSize = selectedDocument?.pageSizes[activePage];
      if (!selectedDocument || !pageSize) return;
      const id = crypto.randomUUID();
      addTextPlacement(selectedDocument.docId, {
        id,
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
      setLibraryOpen(false);
      if (stamp) {
        reportStamp(placementLabel(type), stampPlacementOnEveryPage(selectedDocument.docId, id));
      }
    },
    [activePage, addTextPlacement, announcePlacement, dateFormat, onToast, reportStamp, selectedDocument, stampPlacementOnEveryPage]
  );

  const placeAsset = useCallback(
    async (asset: SignatureAsset, stamp: boolean) => {
      const pageSize = selectedDocument?.pageSizes[activePage];
      if (!selectedDocument || !pageSize) return;
      const width = 0.2;
      const height = Math.max(
        MIN_PLACEMENT_HEIGHT,
        Math.min(width * (asset.height / asset.width) * (pageSize.w / pageSize.h), 0.5)
      );

      const inserted = await addSignaturePlacement(selectedDocument.docId, asset, {
        id: crypto.randomUUID(),
        pageIndex: activePage,
        x: 0.1,
        y: 0.1,
        w: width,
        h: height
      });
      if (!inserted) {
        onToast(STRINGS.editor.placementFailed);
        return;
      }
      announcePlacement(asset.kind, activePage);
      setLibraryOpen(false);
      onToast(STRINGS.announcements.placedOnPage(placementLabel(asset.kind), activePage + 1));
      if (stamp) reportStamp(placementLabel(asset.kind), stampPlacementOnEveryPage(selectedDocument.docId, inserted.id));
    },
    [activePage, addSignaturePlacement, announcePlacement, onToast, reportStamp, selectedDocument, stampPlacementOnEveryPage]
  );
  const handlePlaceAsset = useCallback((asset: SignatureAsset) => { void placeAsset(asset, false); }, [placeAsset]);
  const handleStampAsset = useCallback((asset: SignatureAsset) => { void placeAsset(asset, true); }, [placeAsset]);


  const handleAddPdfs = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (addPdfsRef.current) addPdfsRef.current.value = '';
    if (files.length === 0 || mutationLocked) return;
    const accepted: SessionDocument[] = [];
    let acceptedPageCount = 0;
    let acceptedByteCount = 0;
    for (const file of files) {
      const validationError = getFileValidationError(file, {
        documentCount: documents.length + accepted.length,
        pageCount: documents.reduce((total, document) => total + document.pageCount, 0) + acceptedPageCount,
        byteCount: documents.reduce((total, document) => total + document.pdfBytes.byteLength, 0) + acceptedByteCount
      });
      if (validationError !== null) {
        onToast(REJECTION_REASONS[validationError](file.name));
        continue;
      }
      try {
        const document = await createSessionDocument(file, {
          currentPageCount: documents.reduce((total, item) => total + item.pageCount, 0),
          acceptedPageCount
        });
        accepted.push(document);
        acceptedPageCount += document.pageCount;
        acceptedByteCount += document.pdfBytes.byteLength;
      } catch (error) {
        const code = error instanceof Error && error.message in STRINGS.errors
          ? (error.message as keyof typeof STRINGS.errors)
          : 'corrupt';
        const reason = code === 'corrupt' ? STRINGS.edgeCases.corruptFile(file.name) : STRINGS.errors[code];
        onToast(code === 'corrupt' ? reason : `${file.name} — ${reason}`);
      }
    }
    if (accepted.length === 0) return;
    const outcome = addDocuments(accepted, sessionId);
    if (outcome !== 'ok') onToast(COMMIT_REFUSALS[outcome]);
  }, [addDocuments, documents, mutationLocked, onToast, sessionId]);

  const handlePaste = useCallback(() => {
    if (!selectedDocId) return;
    const pasted = pastePlacement(selectedDocId, activePage);
    if (pasted) {
      announcePlacement(pasted.type, pasted.pageIndex);
      onToast(STRINGS.announcements.placedOnPage(placementLabel(pasted.type), pasted.pageIndex + 1));
    }
  }, [activePage, announcePlacement, onToast, pastePlacement, selectedDocId]);

  const handleDownload = useCallback(async () => {
    if (!selectedDocument || isDownloading || mutationLocked) return;
    setDownloadError(null);
    setIsDownloading(true);
    try {
      const { assertTextExportable, flattenDocument } = await import('../../pdf/flatten');
      const resolvedAt = Date.now();
      await assertTextExportable(selectedDocument, { snapshots: signatureSnapshots, resolvedAt });
      const flattened = await flattenDocument(selectedDocument, { snapshots: signatureSnapshots, resolvedAt });
      const fileName = signedPdfFileName(selectedDocument.fileName);
      const pdfBytes = flattened.buffer.slice(flattened.byteOffset, flattened.byteOffset + flattened.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
      transitionDocumentOutput(selectedDocument.docId, 'signed');
      onToast(STRINGS.editor.downloadSuccess(fileName));
    } catch (error) {
      const message = error instanceof Error ? error.message : STRINGS.editor.downloadFailed;
      setDownloadError(message);
      onToast(message);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, onToast, selectedDocument, signatureSnapshots, transitionDocumentOutput, mutationLocked]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A dialog owns the keyboard while it is open. Without this, Ctrl+Z while
      // drawing a signature undoes Work Session placements instead of a pen stroke,
      // and Ctrl+S downloads the document from under the user.
      if (isEditableTarget(event.target) || isAnyModalOpen()) {
        return;
      }

      const isPrimaryModifier = event.metaKey || event.ctrlKey;
      if (isPrimaryModifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleDownload();
        return;
      }

      if (isPrimaryModifier && event.key.toLowerCase() === 'v') {
        handlePaste();
        return;
      }

      if (isPrimaryModifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (isPrimaryModifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        setShortcutOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDownload, handlePaste, redo, undo]);

  if (!selectedDocument) {
    return null;
  }

  const editorHint = armedSignature
    ? `Click or tap a page to place your ${placementLabel(armedSignature.kind).toLowerCase()}.`
    : isDownloading
      ? 'Preparing your signed PDF…'
      : selectedDocument.status === 'signed'
        ? 'Downloaded. Any new changes will need a fresh download.'
        : !hasPlacements
          ? 'Choose a signature, initials, date or text to begin.'
          : 'Review your placements, then download your PDF.';

  // Shown before download: docked under the library on wide screens, below the
  // workspace on narrow ones (where the library is a dialog).
  const policyDisclosure = (
    <details className="shrink-0 px-1 text-caption text-quiet">
      <summary className="focus-ring w-fit cursor-pointer rounded py-1">Signature and export policy</summary>
      <p className="mt-2 max-w-3xl">{VISUAL_SIGNATURE_DISCLOSURE}</p>
      <p className="mt-1 max-w-3xl">{EXPORT_POLICY_DISCLOSURE}</p>
    </details>
  );

  return (
    <section className="editor-workspace flex flex-1 flex-col lg:min-h-0" aria-label="Document editor">
      <div aria-live="polite" aria-label={STRINGS.liveRegionLabel} className="sr-only-live">
        {announcement}
      </div>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2 sm:px-6">
        {appBrand}
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
          <Button variant="ghost" className="-ml-2 shrink-0 px-2 text-caption" onClick={openQueue}>
            <span aria-hidden="true" className="mr-1">←</span>{STRINGS.queue.allDocuments}
          </Button>
          <h1 className="min-w-0 truncate text-h2 text-ink" title={selectedDocument.fileName}>{selectedDocument.fileName}</h1>
          <p className="shrink-0 whitespace-nowrap text-caption text-quiet">{selectedDocument.pageCount} {selectedDocument.pageCount === 1 ? 'page' : 'pages'}</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={addPdfsRef} hidden type="file" accept="application/pdf" multiple onChange={(event) => { void handleAddPdfs(event.target.files); }} />
          <Button variant="secondary" disabled={mutationLocked} onClick={() => addPdfsRef.current?.click()}>{STRINGS.buttons.addPdfs}</Button>
          <Button
            onClick={() => void handleDownload()}
            disabled={isDownloading || !hasPlacements || mutationLocked || pdfState.status !== 'ready'}
            title={!hasPlacements ? STRINGS.tooltips.nothingPlacedYet : undefined}
          >
            {isDownloading ? STRINGS.editor.downloading : STRINGS.buttons.download}
          </Button>
        </div>
        {appUtilities ? <div className="flex shrink-0 items-center gap-3">{appUtilities}</div> : null}
      </header>
      <div className="flex flex-1 flex-col p-2 pb-32 sm:p-3 lg:min-h-0 lg:pb-3">
      <div className="grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[168px_minmax(0,1fr)_256px] xl:grid-cols-[184px_minmax(0,1fr)_288px]">
        <EditorPanel open={pagesOpen} title={STRINGS.editor.pagesTitle} onClose={() => setPagesOpen(false)}>
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface p-3 lg:flex-1">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <div>
                <h2 className="text-h2 text-ink">{STRINGS.editor.pagesTitle}</h2>
                <p className="mt-1 text-caption text-quiet">{STRINGS.editor.pagesTotal(selectedDocument.pageCount)}</p>
              </div>
            </div>
            <div className="mt-4 min-h-0 overflow-auto">
              <PageThumbnails
                activePage={activePage}
                documentId={selectedDocument.docId}
                pageCount={selectedDocument.pageCount}
                pdf={pdfState.status === 'ready' ? pdfState.pdf : null}
                onSelectPage={(pageIndex) => { selectPage(pageIndex); setPagesOpen(false); }}
              />
            </div>
          </div>
          <ElementsPanel
            document={selectedDocument}
            selectedPlacementId={selectedPlacementId}
            onSelect={(placement) => {
              setSelection(selectedDocument.docId, placement.id);
              selectPage(placement.pageIndex);
              setPagesOpen(false);
            }}
          />
        </EditorPanel>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
          <div role="toolbar" aria-label="Document navigation" className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-2 sm:px-3 lg:flex-nowrap">
            <div className="flex flex-wrap items-center gap-1 lg:shrink-0">
              <Button variant="ghost" className="px-2 lg:hidden"
                aria-expanded={pagesOpen}
                onClick={() => setPagesOpen((open) => !open)}
              >
                <span aria-hidden="true">▤</span><span className="ml-1" aria-hidden="true">Pages</span><span className="sr-only">{pagesOpen ? STRINGS.editor.hidePages : STRINGS.editor.showPages}</span>
              </Button>
              <Button variant="ghost" className="px-2" aria-label="Previous page" disabled={activePage === 0} onClick={() => selectPage(activePage - 1)}>‹</Button>
              <span className="whitespace-nowrap text-caption text-quiet" aria-live="polite">{STRINGS.editor.pageOf(activePage + 1, selectedDocument.pageCount)}</span>
              <Button variant="ghost" className="px-2" aria-label="Next page" disabled={activePage >= selectedDocument.pageCount - 1} onClick={() => selectPage(activePage + 1)}>›</Button>
            </div>
            <div role="status" className={`flex min-w-0 flex-1 basis-28 items-center lg:basis-0 justify-between gap-2 rounded-md px-2 text-caption ${armedSignature ? 'bg-accent-subtle py-0.5 text-ink' : 'text-quiet'}`}>
              <p className="min-w-0 truncate" title={editorHint}>{editorHint}</p>
              {armedSignature ? <Button variant="ghost" className="shrink-0 px-2 py-0 text-caption" onClick={disarmSignature}>{STRINGS.buttons.cancel}</Button> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1 lg:shrink-0">
              <div className="mr-1 flex items-center gap-0.5 border-r border-line pr-2">
                <Button variant="ghost" className="size-8 shrink-0 px-0" aria-label={STRINGS.buttons.undo} title={STRINGS.buttons.undo} onClick={undo} disabled={!canUndo || mutationLocked}><HistoryIcon /></Button>
                <Button variant="ghost" className="size-8 shrink-0 px-0" aria-label={STRINGS.buttons.redo} title={STRINGS.buttons.redo} onClick={redo} disabled={!canRedo || mutationLocked}><HistoryIcon mirrored /></Button>
              </div>
              <div role="group" aria-label={STRINGS.editor.zoomLabel} className="flex items-center rounded-md bg-mist p-0.5">
                {zoomOptions.map((option) => (
                  <button key={option.label} type="button" aria-pressed={zoom === option.value} onClick={() => setZoom(option.value)}
                    className={`focus-ring inline-flex h-8 items-center justify-center rounded-sm px-2 text-caption font-medium transition-colors ${zoom === option.value ? 'bg-ink text-white' : 'text-quiet hover:bg-sunken hover:text-ink'}`}
                  >{option.label}</button>
                ))}
              </div>
              <Button variant="ghost" className="size-8 shrink-0 px-0" aria-label={STRINGS.shortcuts.open} onClick={() => setShortcutOpen(true)}>?</Button>
              <Button variant="secondary" className="ml-1 px-2 lg:hidden"
                aria-expanded={libraryOpen}
                onClick={() => setLibraryOpen((open) => !open)}
              >
                <span aria-hidden="true">Tools</span><span className="sr-only">{libraryOpen ? STRINGS.editor.hideLibrary : STRINGS.editor.showLibrary}</span>
              </Button>
            </div>
          </div>
          {downloadError ? <div role="alert" className="border-b border-danger/20 bg-danger/5 px-3 py-2 text-body text-danger"><p>{downloadError}</p><p className="mt-1 text-caption">Your work is still here. Review the document and try Download again.</p></div> : null}
          <div ref={scrollRootRef} data-testid="editor-scroll" tabIndex={0} aria-label="PDF pages" className="focus-ring h-[65dvh] min-h-[220px] overflow-auto bg-sunken px-3 py-4 lg:h-auto lg:min-h-0 lg:flex-1 lg:px-6">
            <div ref={viewerRef} className="mx-auto max-w-full space-y-6">
              {pdfState.status === 'loading' && <p role="status" className="text-center text-body text-quiet">Opening your PDF…</p>}
              {pdfState.status === 'error' && (
                <div role="alert" className="mx-auto max-w-md rounded-lg border border-line bg-surface p-6 text-body">
                  <h2 className="text-h2 text-ink">This PDF could not be opened</h2>
                  <p className="mt-2 text-quiet">{pdfState.message}</p>
                  <p className="mt-2 text-quiet">Try opening it again, or return to your documents to replace the file.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>
                    <Button variant="secondary" onClick={openQueue}>{STRINGS.queue.allDocuments}</Button>
                    <Button variant="secondary" disabled={mutationLocked} onClick={() => removeDocument(selectedDocument.docId)}>
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
                    onVisibilityChange={onVisibilityChange}
                    onPageElement={onPageElement}
                    onToast={onToast}
                    loading={pdfState.status === 'loading'}
                    onAnnouncePlacement={announcePlacement}
                    armedSignature={armedSignature}
                    onArmedPlacement={disarmSignature}
                  />
                ))}
            </div>
          </div>
        </main>

        <EditorPanel open={libraryOpen} title={STRINGS.library.title} onClose={() => setLibraryOpen(false)}>
          <div className="rounded-lg border border-line bg-surface p-4">
            <LibraryTray
              onToast={onToast}
              onAddDate={() => placeSpecialElement('date')}
              onAddText={() => placeSpecialElement('text')}
              onStampDate={() => placeSpecialElement('date', true)}
              onStampText={() => placeSpecialElement('text', true)}
              onPlaceAsset={handlePlaceAsset}
              onArmAsset={(asset) => { openDocument(selectedDocument.docId, asset); setLibraryOpen(false); }}
              onStampEveryPage={handleStampAsset}
              activePage={activePage}
              placementDisabled={mutationLocked}
            />
          </div>
          {wide ? policyDisclosure : null}
        </EditorPanel>
      </div>
      {wide ? null : policyDisclosure}
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
