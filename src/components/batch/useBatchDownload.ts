import { useCallback, useRef, useState } from 'react';
import { createBatchSigning } from '../../stores/session';
import type { BatchAttemptProgress, BatchSigning } from '../../lib/batchSigning';
import { STRINGS } from '../../lib/strings';

type BatchDownloadState = {
  progress: BatchAttemptProgress | null;
  isRunning: boolean;
  isDelivering: boolean;
};

/** Owns the UI lifecycle of one batch download attempt. Eligibility, lease
 *  safety, and Signed transitions stay in BatchSigning and the session store. */
export function useBatchDownload(onToast: (message: string) => void) {
  const batchRef = useRef<BatchSigning | null>(null);
  const [state, setState] = useState<BatchDownloadState>({ progress: null, isRunning: false, isDelivering: false });

  const start = useCallback(async (docIds?: readonly string[]) => {
    if (batchRef.current) return;

    setState({ progress: { status: 'preparing', done: 0, total: 0, failures: {} }, isRunning: true, isDelivering: false });
    const batch = createBatchSigning(
      (done, total) => setState((current) => current.progress
        ? { ...current, progress: { ...current.progress, done, total } }
        : current),
      (status) => {
        if (status === 'delivering') setState((current) => ({ ...current, isDelivering: true }));
      }
    );
    batchRef.current = batch;

    try {
      const result = await batch.attempt(docIds);
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
      batchRef.current = null;
      setState({ progress: null, isRunning: false, isDelivering: false });
    }
  }, [onToast]);

  const cancel = useCallback(() => {
    batchRef.current?.cancel();
  }, []);

  return { ...state, start, cancel };
}
