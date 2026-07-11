import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from './stores/session';
import { Button, Modal, Toast } from './components/ui';
import { STRINGS } from './lib/strings';
import { DropZone } from './components/DropZone';

const EditorView = lazy(() => import('./components/editor/EditorView').then((module) => ({ default: module.EditorView })));
import { clearSession, saveSession } from './db/history';
import { startupAndDiscover } from './lib/sessionLifecycle';
import type { WorkSession } from './db/schema';

function isQuotaExceededError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

export default function App() {
  const session = useSessionStore((state) => state.session);
  const contentRevision = useSessionStore((state) => state.contentRevision);
  const view = useSessionStore((state) => state.view);
  const documents = session.documents;
  const addDocuments = useSessionStore((state) => state.addDocuments);
  const restoreSession = useSessionStore((state) => state.restoreSession);
  const resetSession = useSessionStore((state) => state.resetSession);
  const mutationLock = useSessionStore((state) => state.mutationLock);
  const [modalOpen, setModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string }>>([
    { id: 'shell-ready', message: STRINGS.appShellReady }
  ]);
  const [resumeSession, setResumeSession] = useState<WorkSession | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [libraryWarning, setLibraryWarning] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const staleSessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const warnedOnQuotaRef = useRef(false);

  const documentCount = documents.length;
  const pageCount = useMemo(() => documents.reduce((total, document) => total + document.pageCount, 0), [documents]);
  const footerText = useMemo(
    () => (documentCount === 0 ? STRINGS.footerEmpty : STRINGS.footerLoaded(documentCount)),
    [documentCount]
  );

  const pushToast = (message: string) => {
    setToasts((items) => [...items, { id: crypto.randomUUID(), message }]);
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await startupAndDiscover();
      if (cancelled) return;
      setResumeSession(result.candidate);
      setLibraryWarning(result.storageAvailable ? null : STRINGS.errors['idb-unavailable']);
      setHistoryReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    const current = sessionRef.current;

    // An empty active Work Session clears only a persisted record with the
    // same Work Session identity — never a separately retained predecessor.
    if (current.documents.length === 0) {
      if (staleSessionIdRef.current !== current.id) {
        void clearSession(current.id);
      }
      return;
    }

    // Nonempty revisions save after the approved debounce; rapid edits
    // replace the pending save with the latest coherent revision.
    const timeout = window.setTimeout(() => {
      void saveSession(sessionRef.current)
        .then(async () => {
          // Predecessor clears only after the first successful nonempty replacement save.
          if (staleSessionIdRef.current && staleSessionIdRef.current !== sessionRef.current.id) {
            await clearSession(staleSessionIdRef.current);
            staleSessionIdRef.current = null;
          }
        })
        .catch((error) => {
          if (isQuotaExceededError(error) && !warnedOnQuotaRef.current) {
            warnedOnQuotaRef.current = true;
            setHistoryWarning(STRINGS.warnings.autosaveOff);
          }
        });
    }, 500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [historyReady, contentRevision]);

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="border-b border-line bg-surface">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-caption uppercase text-quiet">{STRINGS.appName}</p>
            <p className="mt-1 text-body text-quiet">{footerText}</p>
          </div>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            {STRINGS.previewPrimitives}
          </Button>
        </div>
        {resumeSession && view === 'dropzone' && documents.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
            <p className="text-body text-ink">{STRINGS.resumePrompt}</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  staleSessionIdRef.current = resumeSession.id;
                  setResumeSession(null);
                  resetSession();
                }}
              >
                {STRINGS.startFresh}
              </Button>
              <Button
                onClick={async () => {
                  if (await restoreSession(resumeSession)) {
                    setResumeSession(null);
                  }
                }}
              >
                {STRINGS.resume}
              </Button>
            </div>
          </div>
        ) : null}
        {mutationLock ? (
          <div role="status" aria-live="polite" className="border-t border-warning/30 bg-warning/10 px-6 py-3 text-body text-warning">
            {STRINGS.workSessionLocked(mutationLock.owner)}
          </div>
        ) : null}
        {libraryWarning ? <div className="border-t border-warning/30 bg-warning/10 px-6 py-3 text-body text-warning">{libraryWarning}</div> : null}
        {historyWarning ? <div className="border-t border-warning/30 bg-warning/10 px-6 py-3 text-body text-warning">{historyWarning}</div> : null}
      </header>
      {view === 'dropzone' ? (
        <DropZone
          currentDocumentCount={documentCount}
          currentPageCount={pageCount}
          onDocumentsAccepted={addDocuments}
          onToast={pushToast}
        />
      ) : (
        <Suspense
          fallback={<div className="px-6 py-10 text-body text-quiet" role="status">{STRINGS.loading.editor}</div>}
        >
          <EditorView onToast={pushToast} />
        </Suspense>
      )}
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 space-y-3">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))}
          />
        ))}
      </div>
      <Modal open={modalOpen} title={STRINGS.uiPrimitivesTitle} onClose={() => setModalOpen(false)}>
        <div className="space-y-4">
          <p className="text-body text-quiet">{STRINGS.uiPrimitivesBody}</p>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {STRINGS.buttons.close}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
