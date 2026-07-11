import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '../ui';
import { useSessionStore } from '../../stores/session';
import { createBatchSigning } from '../../stores/session';
import type { BatchSigning, BatchAttemptProgress } from '../../lib/batchSigning';
import { STRINGS } from '../../lib/strings';
import type { ApplyToAllPreview } from '../../stores/session';

type ApplyToAllProps = {
  onToast: (message: string) => void;
};

export function ApplyToAll({ onToast }: ApplyToAllProps) {
  const documents = useSessionStore((state) => state.session.documents);
  const previewApplyTemplatePlacements = useSessionStore((state) => state.previewApplyTemplatePlacements);
  const applyTemplatePlacements = useSessionStore((state) => state.applyTemplatePlacements);
  const mutationLocked = useSessionStore((state) => state.mutationLock !== null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyPreview, setApplyPreview] = useState<ApplyToAllPreview | null>(null);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchAttemptProgress | null>(null);
  const [batchDelivering, setBatchDelivering] = useState(false);
  const batchRef = useRef<BatchSigning | null>(null);

  const templateDocument = documents[0] ?? null;
  const targetDocuments = useMemo(() => documents.slice(1), [documents]);
  const downloadableDocuments = useMemo(
    () => documents.filter((document) => document.placements.length > 0 && !document.needsReviewReason && document.status !== 'needs-review'),
    [documents]
  );
  const overwriteCount = applyPreview?.targets.filter((target) => target.overwritesPlacements || target.endsSignedState).length
    ?? targetDocuments.filter((document) => document.placements.length > 0 || document.status === 'signed').length;
  const disabled = mutationLocked || !templateDocument || templateDocument.placements.length === 0 || targetDocuments.length === 0;
  const batchDisabled = mutationLocked || isBatchDownloading || documents.length < 2 || downloadableDocuments.length === 0;

  useEffect(() => {
    const handleShortcut = () => {
      void startBatchDownload();
    };
    window.addEventListener('signlite:batch-download', handleShortcut as EventListener);
    return () => window.removeEventListener('signlite:batch-download', handleShortcut as EventListener);
  });

  const openApplyPreview = () => {
    if (mutationLocked) return;
    const preview = previewApplyTemplatePlacements();
    if (!preview) {
      onToast(STRINGS.batch.nothingToApply);
      return;
    }
    setApplyPreview(preview);
    setConfirmOpen(true);
  };

  const runApply = () => {
    if (mutationLocked) return;
    if (!applyPreview) return;
    const result = applyTemplatePlacements(applyPreview);
    setConfirmOpen(false);
    setApplyPreview(null);
    if (!result.ok) {
      onToast(result.error === 'stale-preview' ? STRINGS.batch.stalePreview : STRINGS.editor.placementFailed);
      return;
    }
    if (result.appliedDocIds.length === 0 && result.needsReviewDocIds.length === 0) {
      onToast(STRINGS.batch.nothingToApply);
      return;
    }
    if (result.appliedDocIds.length > 0 && result.needsReviewDocIds.length > 0) {
      onToast(STRINGS.batch.appliedAndReviewSummary(result.appliedDocIds.length, result.needsReviewDocIds.length));
      return;
    }
    if (result.appliedDocIds.length > 0) {
      onToast(STRINGS.batch.appliedSummary(result.appliedDocIds.length));
      return;
    }
    onToast(STRINGS.batch.reviewSummary(result.needsReviewDocIds.length));
  };

  const startBatchDownload = async () => {
    if (mutationLocked || isBatchDownloading) return;
    if (downloadableDocuments.length === 0) return;

    setIsBatchDownloading(true);
    setBatchProgress({ status: 'preparing', done: 0, total: downloadableDocuments.length, failures: {} });
    setBatchDelivering(false);

    const batch = createBatchSigning(
      (done, total) => setBatchProgress((prev) => prev ? { ...prev, done, total } : prev),
      (status) => {
        if (status === 'delivering') setBatchDelivering(true);
      }
    );
    batchRef.current = batch;

    try {
      const result = await batch.attempt();

      if (result.cancelled) {
        onToast(STRINGS.batch.batchCancelled);
      } else if (result.deliveryFailed) {
        onToast(STRINGS.batch.batchDeliveryFailed);
      } else if (result.noEligible) {
        onToast(STRINGS.batch.batchNoEligible);
      } else if (result.ok) {
        onToast(STRINGS.batch.batchDone(result.successCount));
      } else {
        onToast(STRINGS.batch.batchFailed);
      }
    } catch {
      onToast(STRINGS.batch.batchFailed);
    } finally {
      setIsBatchDownloading(false);
      setBatchProgress(null);
      setBatchDelivering(false);
      batchRef.current = null;
    }
  };

  const handleCancel = () => {
    batchRef.current?.cancel();
  };

  if (documents.length < 2) {
    return null;
  }

  return (
    <>
      <div className="surface-card p-4 shadow-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-h2 text-ink">{STRINGS.batch.applyTitle}</h2>
            <p className="mt-1 text-caption text-quiet">
              {STRINGS.batch.applySubtitle(templateDocument?.fileName ?? 'the template')}
            </p>
          </div>
          <Button type="button" disabled={disabled} onClick={openApplyPreview}>
            {STRINGS.buttons.applyToAll}
          </Button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-body sm:grid-cols-3">
          <div className="bg-mist px-3 py-2">
            <dt className="text-caption uppercase text-quiet">{STRINGS.batch.templatePlacements}</dt>
            <dd className="mt-1 font-medium text-ink">{templateDocument?.placements.length ?? 0}</dd>
          </div>
          <div className="bg-mist px-3 py-2">
            <dt className="text-caption uppercase text-quiet">{STRINGS.batch.targets}</dt>
            <dd className="mt-1 font-medium text-ink">{targetDocuments.length}</dd>
          </div>
          <div className="bg-mist px-3 py-2">
            <dt className="text-caption uppercase text-quiet">{STRINGS.batch.overwrite}</dt>
            <dd className="mt-1 font-medium text-ink">{overwriteCount}</dd>
          </div>
        </dl>
        <div className="mt-4 bg-mist px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-medium text-ink">{STRINGS.batch.downloadTitle}</p>
              <p className="mt-1 text-caption text-quiet">
                {batchProgress
                  ? STRINGS.batch.signingProgress(batchProgress.done, batchProgress.total)
                  : STRINGS.batch.readyForDownload(downloadableDocuments.length)}
              </p>
            </div>
            <div className="flex gap-2">
              {isBatchDownloading && !batchDelivering && (
                <Button type="button" variant="secondary" onClick={handleCancel}>
                  {STRINGS.buttons.cancel}
                </Button>
              )}
              <Button type="button" onClick={() => void startBatchDownload()} disabled={batchDisabled}>
                {isBatchDownloading ? STRINGS.batch.signing : STRINGS.buttons.downloadAll}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <Modal open={confirmOpen} title={STRINGS.batch.replaceTitle} onClose={() => { setConfirmOpen(false); setApplyPreview(null); }}>
        <div className="space-y-4">
          <p className="text-body text-quiet">{STRINGS.batch.replaceBody(overwriteCount)}</p>
          <ul className="space-y-2 text-caption text-quiet">
            {applyPreview?.targets.map((target) => (
              <li key={target.docId}>
                <span className="font-medium text-ink">{target.fileName}</span>{' — '}
                {target.needsReviewReason
                  ?? (target.endsSignedState ? STRINGS.batch.signedWillEnd : STRINGS.batch.placementsWillReplace)}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setConfirmOpen(false); setApplyPreview(null); }}>
              {STRINGS.buttons.cancel}
            </Button>
            <Button onClick={runApply} disabled={mutationLocked}>{STRINGS.buttons.replaceAndApply}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
