import { useMemo, useRef, useState } from 'react';
import { Button } from '../ui';
import { useSessionStore } from '../../stores/session';
import { STRINGS } from '../../lib/strings';

const statusStyles = {
  pending: 'bg-sunken text-quiet',
  placed: 'bg-accent-subtle text-accent',
  signing: 'bg-accent-subtle text-accent',
  signed: 'bg-accent-subtle text-success',
  'needs-review': 'bg-warning/10 text-warning',
  error: 'bg-danger/10 text-danger'
} as const;

const statusLabels = {
  pending: STRINGS.status.pending,
  placed: STRINGS.status.placed,
  signing: STRINGS.status.signing,
  signed: STRINGS.status.signed,
  'needs-review': STRINGS.status.needsReview,
  error: STRINGS.status.error
} as const;

export function BatchPanel() {
  const documents = useSessionStore((state) => state.session.documents);
  const selectedDocumentId = useSessionStore((state) => state.selectedDocumentId);
  const reorderDocuments = useSessionStore((state) => state.reorderDocuments);
  const removeDocument = useSessionStore((state) => state.removeDocument);
  const setSelection = useSessionStore((state) => state.setSelection);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  const orderedIds = useMemo(() => documents.map((document) => document.docId), [documents]);

  if (documents.length < 2) {
    return null;
  }

  const moveDocument = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= orderedIds.length || fromIndex === toIndex) {
      return;
    }
    const nextIds = [...orderedIds];
    const [moved] = nextIds.splice(fromIndex, 1);
    if (!moved) return;
    nextIds.splice(toIndex, 0, moved);
    reorderDocuments(nextIds);
    window.requestAnimationFrame(() => itemRefs.current[toIndex]?.focus());
  };

  return (
    <section className="surface-card p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 text-ink">{STRINGS.batch.title}</h2>
          <p className="mt-1 text-caption text-quiet">{STRINGS.batch.subtitle}</p>
        </div>
      </div>
      <ol className="mt-4 space-y-2">
        {documents.map((document, index) => (
          <li key={document.docId}>
            <div
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="button"
              tabIndex={0}
              draggable
              aria-label={`${document.fileName}, ${statusLabels[document.status]}${document.needsReviewReason ? `, ${STRINGS.status.needsReview}` : ''}`}
              onDragStart={() => setDraggedDocumentId(document.docId)}
              onDragEnd={() => setDraggedDocumentId(null)}
              onDragOver={(event) => {
                if (!draggedDocumentId || draggedDocumentId === document.docId) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedDocumentId || draggedDocumentId === document.docId) {
                  return;
                }
                const nextIds = orderedIds.filter((docId) => docId !== draggedDocumentId);
                nextIds.splice(index, 0, draggedDocumentId);
                reorderDocuments(nextIds);
                setDraggedDocumentId(null);
              }}
              onClick={() => setSelection(document.docId, null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelection(document.docId, null);
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  if (event.altKey) {
                    moveDocument(index, index + 1);
                  } else {
                    itemRefs.current[Math.min(index + 1, documents.length - 1)]?.focus();
                  }
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (event.altKey) {
                    moveDocument(index, index - 1);
                  } else {
                    itemRefs.current[Math.max(index - 1, 0)]?.focus();
                  }
                }
              }}
              className={`focus-ring w-full border px-3 py-3 text-left transition ${
                selectedDocumentId === document.docId
                  ? 'border-accent bg-accent-subtle'
                  : 'border-line bg-surface hover:bg-mist'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-body font-medium text-ink">{document.fileName}</span>
                    {index === 0 ? (
                      <span className="rounded-full bg-ink px-2 py-0.5 text-caption text-white">{STRINGS.status.template}</span>
                    ) : null}
                    <span className={`rounded-full px-2 py-0.5 text-caption ${statusStyles[document.status]}`} title={document.batchError}>
                      {statusLabels[document.status]}
                    </span>
                    {document.needsReviewReason ? (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-caption text-warning">{STRINGS.status.needsReview}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-caption text-quiet">
                    {document.pageCount} page{document.pageCount === 1 ? '' : 's'}
                  </p>
                  {document.batchError ? <p className="mt-1 text-caption text-danger">{document.batchError}</p> : null}
                  {document.needsReviewReason ? <p className="mt-1 text-caption text-warning">{document.needsReviewReason}</p> : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1 text-caption"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeDocument(document.docId);
                  }}
                >
                  {STRINGS.buttons.remove}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
