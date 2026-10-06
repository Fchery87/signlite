import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useSessionStore } from './stores/session';
import { Button, Toast } from './components/ui';
import { STRINGS } from './lib/strings';
import { DropZone } from './components/DropZone';
import { LocalDataControls } from './components/LocalDataControls';
import { useRuntimeReadiness } from './lib/useRuntimeReadiness';
import { ensureRuntimeReady } from './pdf/runtime';

const EditorView = lazy(() => import('./components/editor/EditorView').then((module) => ({ default: module.EditorView })));
import { useSessionLifecycle } from './lib/useSessionLifecycle';

export default function App() {
  const session = useSessionStore((state) => state.session);
  const contentRevision = useSessionStore((state) => state.contentRevision);
  const view = useSessionStore((state) => state.view);
  const documents = session.documents;
  const addDocuments = useSessionStore((state) => state.addDocuments);
  const restoreSession = useSessionStore((state) => state.restoreSession);
  const resetSession = useSessionStore((state) => state.resetSession);
  const mutationLock = useSessionStore((state) => state.mutationLock);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string }>>([]);
  const lifecycle = useSessionLifecycle({ session, contentRevision, resetSession });
  const runtime = useRuntimeReadiness();
  useEffect(() => {
    void ensureRuntimeReady().catch(() => undefined);
  }, []);
  const resumeSession = lifecycle.candidate;
  const historyWarning = lifecycle.warning;

  const documentCount = documents.length;
  const currentPageCount = useMemo(() => documents.reduce((total, document) => total + document.pageCount, 0), [documents]);
  const currentByteCount = useMemo(() => documents.reduce((total, document) => total + document.pdfBytes.byteLength, 0), [documents]);
  const footerText = documentCount === 0 ? null : STRINGS.footerLoaded(documentCount);

  const pushToast = (message: string) => {
    setToasts((items) => [...items, { id: crypto.randomUUID(), message }]);
  };

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="border-b border-line bg-surface">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-caption uppercase text-quiet">{STRINGS.appName}</p>
            <div className="mt-1 flex items-center gap-3">
              {footerText ? <p className="text-body text-quiet">{footerText}</p> : null}
              {lifecycle.status && lifecycle.status !== 'initializing' ? (
                <p className="text-caption text-quiet" data-testid="durability-status">{STRINGS.durability[lifecycle.status]}</p>
              ) : null}
              {lifecycle.authority === 'read-only' ? (
                <p className="text-caption text-warning" data-testid="read-only-banner">{STRINGS.readOnly}</p>
              ) : null}
            </div>
          </div>
        </div>
        {resumeSession && view === 'dropzone' && documents.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
            <p className="text-body text-ink">{STRINGS.resumePrompt}</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={lifecycle.startFresh}
              >
                {STRINGS.startFresh}
              </Button>
              <Button
                onClick={async () => {
                  if (await restoreSession(resumeSession)) lifecycle.resumeSucceeded();
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
        {historyWarning ? <div className="border-t border-warning/30 bg-warning/10 px-6 py-3 text-body text-warning">{historyWarning}</div> : null}
      </header>
      {view === 'dropzone' ? (
        <>
          <div role="status" aria-live="polite" className="border-b border-line bg-surface px-6 py-2 text-caption text-quiet" data-testid="runtime-readiness">
            {runtime.state.status === 'loading'
              ? STRINGS.readiness.preparing
              : runtime.state.status === 'ready'
                ? STRINGS.readiness.ready
                : `${STRINGS.readiness.failed} ${runtime.state.message}`}
            {runtime.state.status === 'failed' ? (
              <Button variant="secondary" className="ml-3" onClick={runtime.retry} data-testid="runtime-retry">
                {STRINGS.readiness.retry}
              </Button>
            ) : null}
          </div>
          <DropZone
            currentDocumentCount={documentCount}
            currentPageCount={currentPageCount}
            currentByteCount={currentByteCount}
            sessionId={session?.id}
            intakeDisabled={runtime.state.status !== 'ready'}
            onDocumentsAccepted={addDocuments}
            onToast={pushToast}
          />
        </>
      ) : (
        <Suspense
          fallback={<div className="px-6 py-10 text-body text-quiet" role="status">{STRINGS.loading.editor}</div>}
        >
          <EditorView onToast={pushToast} />
        </Suspense>
      )}
      <LocalDataControls lifecycle={lifecycle} onToast={pushToast} />
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
    </div>
  );
}
