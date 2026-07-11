import type { Placement, SessionDocument } from '../../db/schema';
import { placementLabel, placementSummary } from '../../lib/placements';
import { STRINGS } from '../../lib/strings';
import { useSessionStore } from '../../stores/session';

type ElementsPanelProps = {
  document: SessionDocument;
  selectedPlacementId: string | null;
  onSelect: (placement: Placement) => void;
};

export function ElementsPanel({ document, selectedPlacementId, onSelect }: ElementsPanelProps) {
  const removePlacement = useSessionStore((state) => state.removePlacement);
  const mutationLocked = useSessionStore((state) => state.mutationLock !== null);

  return (
    <div className="surface-card min-h-0 overflow-auto p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h2 text-ink">{STRINGS.editor.elementsTitle}</h2>
        <span className="text-caption text-quiet">{document.placements.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {document.placements.length === 0 ? (
          <p className="text-caption text-quiet">{STRINGS.editor.elementsEmpty}</p>
        ) : (
          document.placements.map((placement) => (
            <div
              key={placement.id}
              className={`flex items-center justify-between gap-2 border p-2 ${
                placement.id === selectedPlacementId ? 'border-accent bg-accent-subtle' : 'border-line bg-surface'
              }`}
            >
              <button
                type="button"
                className="focus-ring min-w-0 flex-1 text-left"
                onClick={() => onSelect(placement)}
              >
                <span className="block truncate text-body text-ink">{placementSummary(placement)}</span>
                <span className="block text-caption text-quiet">{STRINGS.editor.elementPageLabel(placement.pageIndex + 1)}</span>
              </button>
              <button
                type="button"
                aria-label={STRINGS.editor.deleteElement(placementLabel(placement.type), placement.pageIndex + 1)}
                className="focus-ring px-2 py-1 text-caption text-quiet hover:text-danger"
                disabled={mutationLocked}
                onClick={() => removePlacement(document.docId, placement.id)}
              >
                {STRINGS.buttons.delete}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
