import { useState } from 'react';
import { clearLocalData, type LocalDataClearKind } from '../db/localData';
import { exportLibrary } from '../db/signatures';
import { withSessionLock } from '../lib/sessionOwnership';
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

/** Two separate local-data actions. Clearing history removes Work Sessions.
 *  Clearing all local data also removes the signature library and preferences.
 *  Both refuse to run while another tab owns the session or a batch holds the
 *  mutation lease. The current editor already holds its session lock, so it
 *  clears directly. Asking for that lock again would wait on itself. */
export function LocalDataControls({ lifecycle, onToast }: LocalDataControlsProps) {
  const sessionId = useSessionStore((state: PublicSessionState) => state.session.id);
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

  const erase = (kind: LocalDataClearKind) => {
    lifecycle.prepareForLocalDataClear();
    return clearLocalData(kind);
  };

  const runClear = async () => {
    if (!confirmKind || busy) return;
    const kind = confirmKind;
    setBusy(true);
    try {
      if (lifecycle.authority === 'owner') {
        await erase(kind);
      } else {
        // Without an owned lock, a brief lock is the only way to know another
        // tab is not writing. An unavailable lock refuses the clear.
        const outcome = await withSessionLock(sessionId, () => erase(kind));
        if (outcome.status === 'contended') {
          onToast(STRINGS.localData.anotherTab);
          return;
        }
        if (outcome.status === 'unavailable') {
          onToast(STRINGS.localData.locksUnavailable);
          return;
        }
      }
      resetSession();
      setConfirmKind(null);
      onToast(kind === 'history' ? STRINGS.localData.clearedHistory : STRINGS.localData.clearedAll);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
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
            <Button variant="secondary" onClick={cancel}>
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
