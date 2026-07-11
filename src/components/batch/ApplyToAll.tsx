import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '../ui';
import { useSessionStore } from '../../stores/session';
import { getAsset, getDateFormat } from '../../db/signatures';
import { collectAssetIds, type FlattenAssetMap } from '../../pdf/assets';
import { batchZipFileName, downloadBlob } from '../../lib/files';
import type {
  FlattenWorkerDoneMessage,
  FlattenWorkerErrorMessage,
  FlattenWorkerProgressMessage,
  FlattenWorkerRequest,
  FlattenWorkerResponse
} from '../../workers/flatten.worker';
import { STRINGS } from '../../lib/strings';
import type { ApplyToAllPreview } from '../../lib/workSessionEditor';

type ApplyToAllProps = {
  onToast: (message: string) => void;
};

type BatchProgress = {
  done: number;
  total: number;
};

export function ApplyToAll({ onToast }: ApplyToAllProps) {
  const documents = useSessionStore((state) => state.session.documents);
  const storedSignatureSnapshots = useSessionStore((state) => state.session.signatureSnapshots);
  const signatureSnapshots = useMemo(() => storedSignatureSnapshots ?? {}, [storedSignatureSnapshots]);
  const previewApplyTemplatePlacements = useSessionStore((state) => state.previewApplyTemplatePlacements);
  const applyTemplatePlacements = useSessionStore((state) => state.applyTemplatePlacements);
  const updateDocumentStatus = useSessionStore((state) => state.updateDocumentStatus);
  const setDocumentBatchError = useSessionStore((state) => state.setDocumentBatchError);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyPreview, setApplyPreview] = useState<ApplyToAllPreview | null>(null);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const templateDocument = documents[0] ?? null;
  const targetDocuments = useMemo(() => documents.slice(1), [documents]);
  const downloadableDocuments = useMemo(
    () => documents.filter((document) => document.placements.length > 0 && !document.needsReviewReason && document.status !== 'needs-review'),
    [documents]
  );
  const overwriteCount = applyPreview?.targets.filter((target) => target.overwritesPlacements || target.endsSignedState).length
    ?? targetDocuments.filter((document) => document.placements.length > 0 || document.status === 'signed').length;
  const disabled = !templateDocument || templateDocument.placements.length === 0 || targetDocuments.length === 0;
  const batchDisabled = isBatchDownloading || documents.length < 2 || downloadableDocuments.length === 0;

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const openApplyPreview = () => {
    const preview = previewApplyTemplatePlacements();
    if (!preview) {
      onToast(STRINGS.batch.nothingToApply);
      return;
    }
    setApplyPreview(preview);
    setConfirmOpen(true);
  };

  const runApply = () => {
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
    if (batchDisabled) {
      return;
    }

    setIsBatchDownloading(true);
    setBatchProgress({ done: 0, total: downloadableDocuments.length });

    try {
      const assetMap: FlattenAssetMap = {};
      const assetIds = collectAssetIds(downloadableDocuments);
      const assets = await Promise.all(assetIds.map(async (assetId) => [assetId, await getAsset(assetId)] as const));

      for (const [assetId, asset] of assets) {
        if (asset) {
          assetMap[assetId] = asset.pngBytes;
        }
      }

      for (const document of downloadableDocuments) {
        updateDocumentStatus(document.docId, 'signing');
        setDocumentBatchError(document.docId, null);
      }

      const snapshots = Object.fromEntries(
        Object.entries(signatureSnapshots).map(([id, snapshot]) => [id, { ...snapshot, pngBytes: snapshot.pngBytes.slice(0) }])
      );
      const request: FlattenWorkerRequest = {
        kind: 'flatten',
        snapshots,
        docs: downloadableDocuments.map((document) => ({
          ...document,
          pdfBytes: document.pdfBytes.slice(0),
          placements: document.placements.map((placement) => ({ ...placement })),
          pageSizes: document.pageSizes.map((page) => ({ ...page }))
        })),
        assets: assetMap,
        zip: true,
        dateFormat: getDateFormat()
      };

      const transfers: Transferable[] = [
        ...request.docs.map((document) => document.pdfBytes),
        ...Object.values(assetMap),
        ...Object.values(snapshots).map((snapshot) => snapshot.pngBytes)
      ];

      const worker = new Worker(new URL('../../workers/flatten.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current?.terminate();
      workerRef.current = worker;
      let successCount = 0;

      const result = await new Promise<{ message: FlattenWorkerDoneMessage; successCount: number }>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<FlattenWorkerResponse>) => {
          const message = event.data;

          if (message.kind === 'progress') {
            const progress = message as FlattenWorkerProgressMessage;
            successCount += 1;
            setBatchProgress({ done: progress.done, total: progress.total });
            updateDocumentStatus(progress.docId, 'signed');
            setDocumentBatchError(progress.docId, null);
            return;
          }

          if (message.kind === 'error') {
            const errorMessage = message as FlattenWorkerErrorMessage;
            if (errorMessage.docId) {
              updateDocumentStatus(errorMessage.docId, 'error');
              setDocumentBatchError(errorMessage.docId, errorMessage.message);
              return;
            }

            reject(new Error(errorMessage.message));
            return;
          }

          resolve({ message: message as FlattenWorkerDoneMessage, successCount });
        };

        worker.onerror = () => reject(new Error(STRINGS.batch.batchFailed));
        worker.postMessage(request, transfers);
      });

      downloadBlob(new Blob([result.message.output], { type: result.message.mime }), batchZipFileName());
      onToast(STRINGS.batch.batchDone(result.successCount));
    } catch (error) {
      onToast(error instanceof Error ? error.message : STRINGS.batch.batchFailed);
    } finally {
      setIsBatchDownloading(false);
      setBatchProgress(null);
      workerRef.current?.terminate();
      workerRef.current = null;
    }
  };

  useEffect(() => {
    const handleShortcut = () => {
      void startBatchDownload();
    };

    window.addEventListener('signlite:batch-download', handleShortcut as EventListener);
    return () => window.removeEventListener('signlite:batch-download', handleShortcut as EventListener);
  });

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
          <Button
            type="button"
            disabled={disabled}
            onClick={openApplyPreview}
          >
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
            <Button type="button" onClick={() => void startBatchDownload()} disabled={batchDisabled}>
              {isBatchDownloading ? STRINGS.batch.signing : STRINGS.buttons.downloadAll}
            </Button>
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
            <Button onClick={runApply}>{STRINGS.buttons.replaceAndApply}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
