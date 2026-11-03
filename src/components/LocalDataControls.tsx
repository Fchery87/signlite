import { useEffect, useRef, useState } from 'react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu item unmounts when the menu closes, so hand focus to the menu button
  // first: the confirmation dialog then returns focus there when it closes.
  const choose = (kind: LocalDataClearKind) => {
    menuRef.current?.querySelector<HTMLButtonElement>('[data-testid="local-data-menu"]')?.focus();
    setMenuOpen(false);
    openConfirm(kind);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

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
      <div ref={menuRef} className="relative">
        <Button
          variant="ghost"
          className="px-2 text-caption"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          data-testid="local-data-menu"
        >
          {STRINGS.localData.menuButton}
        </Button>
        {menuOpen ? (
          <div
            role="group"
            aria-label={STRINGS.localData.menuButton}
            className="absolute right-0 top-full z-40 mt-1 flex w-60 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-modal"
          >
            <p className="text-caption text-quiet">{STRINGS.localData.menuNote}</p>
            <Button variant="secondary" onClick={() => choose('history')} data-testid="clear-history">
              {STRINGS.localData.clearHistoryButton}
            </Button>
            <Button variant="secondary" className="text-danger" onClick={() => choose('all')} data-testid="clear-all-data">
              {STRINGS.localData.clearAllButton}
            </Button>
          </div>
        ) : null}
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
