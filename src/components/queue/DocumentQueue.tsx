import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionDocument } from '../../db/schema';
import { STRINGS } from '../../lib/strings';
import { EXPORT_POLICY_DISCLOSURE } from '../../lib/productPolicy';
import { selectEditingBlocked, useSessionStore } from '../../stores/session';
import { useBatchDownload } from '../batch/useBatchDownload';
import { Button, Modal, isAnyModalOpen } from '../ui';
import { SignatureDock } from './SignatureDock';
import { TemplateApplyDialog } from './TemplateApplyDialog';
import { useSignatureAssets } from './useSignatureAssets';

type QueueFilter = 'all' | 'review' | 'signed';

const STATUS_LABELS: Record<SessionDocument['status'], string> = {
  pending: STRINGS.queue.readyToSign,
  placed: STRINGS.queue.readyToDownload,
  signing: STRINGS.status.signing,
  signed: STRINGS.status.signed,
  'needs-review': STRINGS.status.needsReview,
  error: STRINGS.status.error
};

const STATUS_SHORT_LABELS: Record<SessionDocument['status'], string> = {
  pending: STRINGS.queue.readyToSign,
  placed: STRINGS.queue.readyToSign,
  signing: STRINGS.status.signing,
  signed: STRINGS.status.signed,
  'needs-review': STRINGS.queue.review,
  error: STRINGS.status.error
};

const STATUS_TONES: Record<SessionDocument['status'], string> = {
  pending: 'text-quiet',
  placed: 'text-ink',
  signing: 'text-ink',
  signed: 'text-success',
  'needs-review': 'text-warning',
  error: 'text-danger'
};

function needsReview(document: SessionDocument) {
  return document.status === 'needs-review' || Boolean(document.needsReviewReason);
}

function canDownload(document: SessionDocument) {
  return document.placements.length > 0 && !needsReview(document);
}

export function DocumentQueue({ onToast }: { onToast: (message: string) => void }) {
  const documents = useSessionStore((state) => state.session.documents);
  const openDocument = useSessionStore((state) => state.openDocument);
  const openDropzone = useSessionStore((state) => state.openDropzone);
  const applySignatureToDocuments = useSessionStore((state) => state.applySignatureToDocuments);
  const previewSavedSignatureApply = useSessionStore((state) => state.previewSavedSignatureApply);
  const reorderDocuments = useSessionStore((state) => state.reorderDocuments);
  const removeDocument = useSessionStore((state) => state.removeDocument);
  const mutationLocked = useSessionStore(selectEditingBlocked);
  const { assets, selected: signature, select: selectSignature, refresh: refreshSignatures } = useSignatureAssets();
  const batch = useBatchDownload(onToast);

  const [filter, setFilter] = useState<QueueFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [actionDocId, setActionDocId] = useState<string | null>(null);
  const [templateSourceId, setTemplateSourceId] = useState<string | null>(null);
  const reorderRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const reviewCount = useMemo(() => documents.filter(needsReview).length, [documents]);
  const downloadableCount = useMemo(() => documents.filter(canDownload).length, [documents]);
  const selectedDocuments = useMemo(() => documents.filter((document) => selected.has(document.docId)), [documents, selected]);
  const applyPreview = useMemo(
    () => signature
      ? previewSavedSignatureApply(selectedDocuments.map((document) => document.docId), signature.kind, {
          replaceExisting: true,
          includeNeedsReview: true
        })
      : null,
    [previewSavedSignatureApply, selectedDocuments, signature]
  );
  const signatureTargets = applyPreview?.targets ?? [];
  const replacementCount = signatureTargets.filter((target) => target.replacesExisting).length;
  const reviewCountForApply = signatureTargets.filter((target) => target.needsReview).length;
  const signedEndCount = signatureTargets.filter((target) => target.endsSignedState).length;
  const downloadTargets = useMemo(() => selectedDocuments.filter(canDownload), [selectedDocuments]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesFilter =
        filter === 'all'
        || (filter === 'review' && needsReview(document))
        || (filter === 'signed' && document.status === 'signed');
      const matchesQuery = needle.length === 0 || document.fileName.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [documents, filter, query]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((document) => selected.has(document.docId));
  const actionDocument = documents.find((document) => document.docId === actionDocId) ?? null;
  const templateSource = documents.find((document) => document.docId === templateSourceId) ?? null;

  const toggle = (docId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) filtered.forEach((document) => next.delete(document.docId));
      else filtered.forEach((document) => next.add(document.docId));
      return next;
    });
  };

  const rowAction = (document: SessionDocument) => {
    if (needsReview(document)) {
      return { label: STRINGS.queue.review, arm: false };
    }
    if (document.status === 'pending' && signature) {
      return { label: STRINGS.queue.sign, arm: true };
    }
    return { label: STRINGS.queue.open, arm: false };
  };

  const moveDocument = (docId: string, offset: number) => {
    if (mutationLocked) return;
    const index = documents.findIndex((document) => document.docId === docId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= documents.length) return;
    const ids = documents.map((document) => document.docId);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(target, 0, moved);
    reorderDocuments(ids);
    window.requestAnimationFrame(() => reorderRefs.current[docId]?.focus());
  };

  const runApply = async () => {
    if (!signature || signatureTargets.length === 0 || applying) return;
    setApplying(true);
    try {
      const outcome = await applySignatureToDocuments(
        signature,
        signatureTargets.map((target) => target.docId),
        { replaceExisting: true, includeNeedsReview: true }
      );
      if (!outcome.ok) {
        onToast(STRINGS.queue.nothingApplied);
        return;
      }
      setApplyOpen(false);
      onToast(outcome.skipped.length > 0
        ? STRINGS.queue.appliedSkipped(outcome.appliedDocIds.length, outcome.skipped.length)
        : STRINGS.queue.applied(outcome.appliedDocIds.length));
    } finally {
      setApplying(false);
    }
  };

  const startDownload = (docIds?: string[]) => {
    if (mutationLocked || batch.isRunning || docIds?.length === 0) return;
    void batch.start(docIds);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAnyModalOpen()) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (mutationLocked || batch.isRunning || downloadableCount === 0) return;
        void batch.start();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [batch, downloadableCount, mutationLocked]);

  return (
    <section className="flex-1 px-4 py-4 pb-24 sm:px-6">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_296px]">
        <main className="surface-card min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h1 className="text-display text-ink">{STRINGS.queue.title}</h1>
              <p className="mt-1 text-body text-quiet">{STRINGS.queue.summary(documents.length, reviewCount)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={openDropzone}>{STRINGS.queue.addPdfs}</Button>
              {batch.isRunning && !batch.isDelivering ? (
                <Button variant="secondary" onClick={batch.cancel}>{STRINGS.queue.cancel}</Button>
              ) : null}
              <Button
                disabled={mutationLocked || batch.isRunning || downloadableCount === 0}
                onClick={() => startDownload()}
              >
                {batch.isRunning
                  ? STRINGS.queue.signingProgress(batch.progress?.done ?? 0, batch.progress?.total ?? 0)
                  : STRINGS.queue.downloadAll}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="flex gap-1 bg-sunken p-0.5" role="group" aria-label="Filter documents">
              {([
                ['all', `${STRINGS.queue.filterAll} ${documents.length}`],
                ['review', `${STRINGS.queue.filterReview} ${reviewCount}`],
                ['signed', `${STRINGS.queue.filterSigned} ${documents.filter((document) => document.status === 'signed').length}`]
              ] as Array<[QueueFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={`focus-ring h-7 px-2.5 text-caption transition-colors ${
                    filter === value ? 'border border-line bg-surface text-ink' : 'border border-transparent text-quiet hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={STRINGS.queue.searchPlaceholder}
              aria-label={STRINGS.queue.searchPlaceholder}
              className="focus-ring h-8 w-full max-w-64 border border-line bg-surface px-2.5 text-body text-ink placeholder:text-quiet"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-mist/60 text-caption text-quiet">
                  <th className="w-9 py-2 pl-3 pr-1 sm:w-10 sm:pl-5 sm:pr-2">
                    <input
                      type="checkbox"
                      aria-label={STRINGS.queue.selectAll}
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="size-[15px] accent-[#1a1a18]"
                    />
                  </th>
                  <th className="w-7 py-2 pr-1 sm:w-8 sm:pr-2"><span className="sr-only">Reorder</span></th>
                  <th className="py-2 pr-2 font-medium sm:pr-4">{STRINGS.queue.columnDocument}</th>
                  <th className="hidden w-20 py-2 pr-4 font-medium sm:table-cell">{STRINGS.queue.columnPages}</th>
                  <th className="w-24 py-2 pr-2 font-medium sm:w-40 sm:pr-4">{STRINGS.queue.columnStatus}</th>
                  <th className="w-10 py-2 pr-2 font-medium sm:w-24 sm:pr-5">
                    <span className="sr-only sm:not-sr-only">{STRINGS.queue.columnAction}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((document) => {
                  const action = rowAction(document);
                  const status = needsReview(document) ? 'needs-review' : document.status;
                  return (
                    <tr
                      key={document.docId}
                      data-testid="queue-row"
                      className={`border-b border-line transition-colors last:border-b-0 ${selected.has(document.docId) ? 'bg-accent-subtle' : 'hover:bg-mist/70'} ${draggedDocId === document.docId ? 'opacity-50' : ''}`}
                      onDragOver={(event) => {
                        if (!mutationLocked && draggedDocId && draggedDocId !== document.docId) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!draggedDocId || draggedDocId === document.docId) return;
                        const ids = documents.map((candidate) => candidate.docId).filter((docId) => docId !== draggedDocId);
                        const targetIndex = documents.findIndex((candidate) => candidate.docId === document.docId);
                        ids.splice(targetIndex, 0, draggedDocId);
                        reorderDocuments(ids);
                        setDraggedDocId(null);
                      }}
                    >
                      <td className="py-3 pl-3 pr-1 sm:pl-5 sm:pr-2">
                        <input
                          type="checkbox"
                          aria-label={STRINGS.queue.selectDocument(document.fileName)}
                          checked={selected.has(document.docId)}
                          onChange={() => toggle(document.docId)}
                          className="size-[15px] accent-[#1a1a18]"
                        />
                      </td>
                      <td className="py-3 pr-1 sm:pr-2">
                        <button
                          ref={(element) => {
                            reorderRefs.current[document.docId] = element;
                          }}
                          type="button"
                          draggable={!mutationLocked}
                          aria-label={`Reorder ${document.fileName}. Press Alt plus Arrow Up or Down to move.`}
                          title="Drag to reorder"
                          onDragStart={(event) => {
                            if (mutationLocked) {
                              event.preventDefault();
                              return;
                            }
                            setDraggedDocId(document.docId);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => setDraggedDocId(null)}
                          onKeyDown={(event) => {
                            if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                              event.preventDefault();
                              moveDocument(document.docId, event.key === 'ArrowUp' ? -1 : 1);
                              return;
                            }
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                            event.preventDefault();
                            const index = filtered.findIndex((candidate) => candidate.docId === document.docId);
                            const next = filtered[index + (event.key === 'ArrowUp' ? -1 : 1)];
                            if (next) reorderRefs.current[next.docId]?.focus();
                          }}
                          className="focus-ring flex h-7 w-6 cursor-grab items-center justify-center text-quiet hover:text-ink active:cursor-grabbing"
                        >
                          <svg viewBox="0 0 10 16" className="h-4 w-2.5" fill="currentColor" aria-hidden="true">
                            <circle cx="2" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
                            <circle cx="2" cy="8" r="1" /><circle cx="8" cy="8" r="1" />
                            <circle cx="2" cy="13" r="1" /><circle cx="8" cy="13" r="1" />
                          </svg>
                        </button>
                      </td>
                      <td className="min-w-0 py-3 pr-2 sm:pr-4">
                        <button
                          type="button"
                          onClick={() => openDocument(document.docId)}
                          className="focus-ring block w-full truncate text-left text-body font-medium text-ink"
                          title={document.fileName}
                        >
                          {document.fileName}
                        </button>
                        {document.batchError ? <p className="mt-0.5 text-caption text-danger">{document.batchError}</p> : null}
                        {document.needsReviewReason ? <p className="mt-0.5 text-caption text-warning">{document.needsReviewReason}</p> : null}
                      </td>
                      <td className="hidden py-3 pr-4 text-caption text-quiet sm:table-cell">{document.pageCount}</td>
                      <td className="py-3 pr-2 sm:pr-4">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-caption ${STATUS_TONES[status]}`}>
                          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                          <span className="sm:hidden">{STATUS_SHORT_LABELS[status]}</span>
                          <span className="hidden sm:inline">{STATUS_LABELS[status]}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-2 sm:pr-5">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            className="hidden px-1.5 text-caption font-medium text-ink sm:inline-flex"
                            onClick={() => openDocument(document.docId, action.arm ? signature : null)}
                          >
                            {action.label}
                          </Button>
                          <button
                            type="button"
                            aria-label={STRINGS.queue.moreActions(document.fileName)}
                            aria-expanded={actionDocId === document.docId}
                            onClick={() => setActionDocId(document.docId)}
                            className="focus-ring flex size-7 items-center justify-center rounded-sm text-quiet hover:bg-sunken hover:text-ink"
                          >
                            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                              <circle cx="3" cy="8" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="13" cy="8" r="1.2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 ? <p className="px-5 py-12 text-center text-body text-quiet">{STRINGS.queue.empty}</p> : null}
          </div>
        </main>

        <div className="flex min-w-0 flex-col gap-4">
          <SignatureDock
            assets={assets}
            selected={signature}
            onSelect={selectSignature}
            onRefresh={refreshSignatures}
            onToast={onToast}
          />
          <div className="surface-card p-4">
            <p className="text-body font-medium text-ink">{STRINGS.queue.localOnly}</p>
            <p className="mt-1 text-caption leading-5 text-quiet">{STRINGS.queue.localNote}</p>
            <p className="mt-2 text-caption text-quiet">{STRINGS.batch.readyForDownload(downloadableCount)}</p>
            <p className="mt-2 border-t border-line pt-2 text-caption leading-5 text-quiet">{EXPORT_POLICY_DISCLOSURE}</p>
          </div>
        </div>
      </div>

      {selectedDocuments.length > 0 ? (
        <div className="fixed bottom-20 left-1/2 z-40 flex w-[min(760px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center gap-2 bg-ink px-4 py-2.5 text-white shadow-modal">
          <p className="mr-auto text-body text-white/75">
            <span className="font-medium text-white">{STRINGS.queue.selected(selectedDocuments.length)}</span>
          </p>
          <Button
            variant="secondary"
            disabled={!signature || signatureTargets.length === 0 || mutationLocked || applying}
            onClick={() => setApplyOpen(true)}
          >
            {STRINGS.queue.applySignature}
          </Button>
          <Button
            variant="ghost"
            className="text-white/75 hover:bg-white/10 hover:text-white"
            disabled={batch.isRunning || downloadTargets.length === 0}
            onClick={() => startDownload(downloadTargets.map((document) => document.docId))}
          >
            {STRINGS.queue.downloadSelected}
          </Button>
          <Button
            variant="ghost"
            className="text-white/75 hover:bg-white/10 hover:text-white"
            onClick={() => setSelected(new Set())}
          >
            {STRINGS.queue.clearSelection}
          </Button>
        </div>
      ) : null}

      <Modal open={applyOpen} title={STRINGS.queue.applyTitle(signatureTargets.length)} onClose={() => setApplyOpen(false)}>
        <div className="space-y-4">
          <p className="text-body leading-6 text-quiet">
            {STRINGS.queue.applyBody(
              signatureTargets.length,
              replacementCount,
              reviewCountForApply,
              signedEndCount,
              selectedDocuments.length - signatureTargets.length
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setApplyOpen(false)}>{STRINGS.buttons.cancel}</Button>
            <Button disabled={applying || mutationLocked} onClick={() => void runApply()}>
              {STRINGS.queue.applyConfirm(signatureTargets.length)}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={actionDocument !== null}
        title={actionDocument?.fileName ?? ''}
        onClose={() => setActionDocId(null)}
      >
        {actionDocument ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setActionDocId(null);
                openDocument(actionDocument.docId);
              }}
            >
              {STRINGS.queue.openInEditor}
            </Button>
            {actionDocument.status === 'pending' && signature ? (
              <Button
                onClick={() => {
                  setActionDocId(null);
                  openDocument(actionDocument.docId, signature);
                }}
              >
                {STRINGS.queue.sign}
              </Button>
            ) : null}
            {actionDocument.placements.length > 0 && documents.length > 1 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setTemplateSourceId(actionDocument.docId);
                  setActionDocId(null);
                }}
              >
                {STRINGS.queue.templateAction}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={documents.findIndex((document) => document.docId === actionDocument.docId) <= 0}
              onClick={() => {
                moveDocument(actionDocument.docId, -1);
                setActionDocId(null);
              }}
            >
              {STRINGS.queue.moveUp}
            </Button>
            <Button
              variant="secondary"
              disabled={documents.findIndex((document) => document.docId === actionDocument.docId) >= documents.length - 1}
              onClick={() => {
                moveDocument(actionDocument.docId, 1);
                setActionDocId(null);
              }}
            >
              {STRINGS.queue.moveDown}
            </Button>
            <Button
              variant="secondary"
              className="text-danger"
              disabled={mutationLocked}
              onClick={() => {
                const docId = actionDocument.docId;
                setSelected((current) => {
                  const next = new Set(current);
                  next.delete(docId);
                  return next;
                });
                removeDocument(docId);
                setActionDocId(null);
              }}
            >
              {STRINGS.queue.removeDocument}
            </Button>
          </div>
        ) : null}
      </Modal>

      <TemplateApplyDialog
        sourceDocId={templateSourceId}
        sourceFileName={templateSource?.fileName ?? ''}
        onClose={() => setTemplateSourceId(null)}
        onToast={onToast}
      />
    </section>
  );
}
