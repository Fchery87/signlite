import { useState } from 'react';
import { type LocalDataClearKind } from '../db/localData';
import { clearAllLocalDataSafely, clearHistorySafely } from '../lib/localDataMaintenance';
import { exportLibrary } from '../db/signatures';
import type { useSessionLifecycle } from '../lib/useSessionLifecycle';
import { useSessionStore } from '../stores/session';
import type { PublicSessionState } from '../stores/session';
import { STRINGS } from '../lib/strings';
import { Button, Modal } from './ui';

type Lifecycle = ReturnType<typeof useSessionLifecycle>;

type LocalDataControlsProps = {
  lifecycle: Lifecycle;
  onToast: (message: string) => void;
};

/** Drain this tab's writer before maintenance. A failed clear resumes the same
 *  identity. A successful clear discards the old observation before reset. */
export function LocalDataControls({ lifecycle, onToast }: LocalDataControlsProps) {
  const resetSession = useSessionStore((state: PublicSessionState) => state.resetSession);
  const mutationLocked = useSessionStore((state: PublicSessionState) => state.mutationLock !== null);
  const [confirmKind, setConfirmKind] = useState<LocalDataClearKind | null>(null);
  const [busy, setBusy] = useState(false);

  const openConfirm = (kind: LocalDataClearKind) => {
    if (mutationLocked) {
      onToast(STRINGS.localData.busyBatch);
      return;
    }
    if (lifecycle.authority === 'read-only') {
      onToast(STRINGS.localData.anotherTab);
      return;
    }
    setConfirmKind(kind);
  };

  const erase = async (_kind: LocalDataClearKind) => {
    await lifecycle.prepareForLocalDataClear();
    const result = _kind === 'all' ? await clearAllLocalDataSafely() : await clearHistorySafely();
    if (result.status === 'blocked') throw new Error(STRINGS.localData.locksUnavailable);
    if (result.status === 'failed') throw result.cause;
    return result;
  };

  const runClear = async () => {
    if (!confirmKind || busy) return;
    const kind = confirmKind;
    setBusy(true);
    try {
      const result = await erase(kind);
      lifecycle.completeLocalDataClear();
      resetSession();
      setConfirmKind(null);
      onToast(result.retainedActive > 0
        ? `Cleared ${result.deleted} saved sessions. Kept ${result.retainedActive} active or changed sessions. Signatures and preferences kept.`
        : kind === 'history' ? STRINGS.localData.clearedHistory : STRINGS.localData.clearedAll);
    } catch {
      await lifecycle.resumeAfterLocalDataClear();
      onToast('Local data could not be cleared. Your current work has not been reset.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy) return;
    setConfirmKind(null);
  };

  const title = confirmKind === 'all' ? STRINGS.localData.clearAllTitle : STRINGS.localData.clearHistoryTitle;

  return (
    <>
      <div className="flex flex-wrap gap-2 border-t border-line px-6 py-3">
        <Button variant="secondary" onClick={() => openConfirm('history')} data-testid="clear-history">
          {STRINGS.localData.clearHistoryButton}
        </Button>
        <Button variant="secondary" onClick={() => openConfirm('all')} data-testid="clear-all-data">
          {STRINGS.localData.clearAllButton}
        </Button>
      </div>
      <Modal open={confirmKind !== null} title={title} onClose={cancel}>
        <div className="space-y-4">
          <p className="text-body text-ink">{confirmKind === 'all' ? STRINGS.localData.clearAllBody : STRINGS.localData.clearHistoryBody}</p>
          <p className="text-caption text-quiet">{STRINGS.localData.retentionNote}</p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void exportLibrary().then((blob: Blob) => {
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'signlite-library.json';
                anchor.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            {STRINGS.localData.exportFirst}
          </Button>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={cancel}>
              {STRINGS.buttons.cancel}
            </Button>
            <Button variant="secondary" className="text-danger" disabled={busy} onClick={() => void runClear()} data-testid="confirm-clear">
              {STRINGS.buttons.clear}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
