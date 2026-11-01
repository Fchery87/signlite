import { useMemo, useState } from 'react';
import type { SessionDocument } from '../../db/schema';
import { STRINGS } from '../../lib/strings';
import { useSessionStore } from '../../stores/session';
import { useBatchDownload } from '../batch/useBatchDownload';
import { Button, Modal } from '../ui';
import { SignatureDock } from './SignatureDock';
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

function hasSignature(document: SessionDocument) {
  return document.placements.some((placement) => placement.type === 'signature' || placement.type === 'initials');
}

function canTakeSignature(document: SessionDocument) {
  return !needsReview(document) && !hasSignature(document) && document.pageSizes.length > 0;
}

function canDownload(document: SessionDocument) {
  return document.placements.length > 0 && !needsReview(document);
}

export function DocumentQueue({ onToast }: { onToast: (message: string) => void }) {
  const documents = useSessionStore((state) => state.session.documents);
  const openDocument = useSessionStore((state) => state.openDocument);
  const openDropzone = useSessionStore((state) => state.openDropzone);
  const applySignatureToDocuments = useSessionStore((state) => state.applySignatureToDocuments);
  const mutationLocked = useSessionStore((state) => state.mutationLock !== null);
  const { assets, selected: signature, select: selectSignature, refresh: refreshSignatures } = useSignatureAssets();
  const batch = useBatchDownload(onToast);

  const [filter, setFilter] = useState<QueueFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const reviewCount = useMemo(() => documents.filter(needsReview).length, [documents]);
  const downloadableCount = useMemo(() => documents.filter(canDownload).length, [documents]);
  const selectedDocuments = useMemo(() => documents.filter((document) => selected.has(document.docId)), [documents, selected]);
  const signatureTargets = useMemo(() => selectedDocuments.filter(canTakeSignature), [selectedDocuments]);
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

  const runApply = async () => {
    if (!signature || signatureTargets.length === 0 || applying) return;
    setApplying(true);
    try {
      const outcome = await applySignatureToDocuments(signature, signatureTargets.map((document) => document.docId));
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

  return (
    <section className="min-h-[calc(100vh-73px)] px-4 py-4 pb-24 sm:px-6">
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
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-mist/60 text-caption text-quiet">
                  <th className="w-10 py-2 pl-5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={STRINGS.queue.selectAll}
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="size-[15px] accent-[#1a1a18]"
                    />
                  </th>
                  <th className="py-2 pr-4 font-medium">{STRINGS.queue.columnDocument}</th>
                  <th className="w-20 py-2 pr-4 font-medium">{STRINGS.queue.columnPages}</th>
                  <th className="w-40 py-2 pr-4 font-medium">{STRINGS.queue.columnStatus}</th>
                  <th className="w-20 py-2 pr-5 font-medium">{STRINGS.queue.columnAction}</th>
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
                      className={`border-b border-line transition-colors last:border-b-0 ${selected.has(document.docId) ? 'bg-accent-subtle' : 'hover:bg-mist/70'}`}
                    >
                      <td className="py-3 pl-5 pr-2">
                        <input
                          type="checkbox"
                          aria-label={STRINGS.queue.selectDocument(document.fileName)}
                          checked={selected.has(document.docId)}
                          onChange={() => toggle(document.docId)}
                          className="size-[15px] accent-[#1a1a18]"
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          onClick={() => openDocument(document.docId)}
                          className="focus-ring block max-w-full truncate text-left text-body font-medium text-ink"
                          title={document.fileName}
                        >
                          {document.fileName}
                        </button>
                        {document.batchError ? <p className="mt-0.5 text-caption text-danger">{document.batchError}</p> : null}
                        {document.needsReviewReason ? <p className="mt-0.5 text-caption text-warning">{document.needsReviewReason}</p> : null}
                      </td>
                      <td className="py-3 pr-4 text-caption text-quiet">{document.pageCount}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1.5 text-caption ${STATUS_TONES[status]}`}>
                          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                          {STATUS_LABELS[status]}
                        </span>
                      </td>
                      <td className="py-3 pr-5">
                        <Button
                          variant="ghost"
                          className="px-2 text-caption font-medium text-ink"
                          onClick={() => openDocument(document.docId, action.arm ? signature : null)}
                        >
                          {action.label}
                        </Button>
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
          <p className="text-body leading-6 text-quiet">{STRINGS.queue.applyBody(signatureTargets.length, selectedDocuments.length - signatureTargets.length)}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setApplyOpen(false)}>{STRINGS.buttons.cancel}</Button>
            <Button disabled={applying || mutationLocked} onClick={() => void runApply()}>
              {STRINGS.queue.applyConfirm(signatureTargets.length)}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
