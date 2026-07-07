import { useEffect } from 'react';
import type { DragEvent } from 'react';
import type { Placement, SignatureAsset } from '../../db/schema';
import { getAsset, touchAsset } from '../../db/signatures';
import { clampRect, screenToNormalized } from '../../pdf/coords';
import { useSessionStore } from '../../stores/session';
import { PlacedElement } from './PlacedElement';
import { STRINGS } from '../../lib/strings';

type DragAssetPayload = Pick<SignatureAsset, 'id' | 'kind' | 'width' | 'height'>;

type PlacementLayerProps = {
  documentId: string;
  pageIndex: number;
  pageSize: { w: number; h: number };
  placements: Placement[];
  scale: number;
  selectedPlacementId: string | null;
  onToast?: (message: string) => void;
  onAnnouncePlacement?: (type: Placement['type'], pageIndex: number) => void;
};

const ASSET_DRAG_TYPE = 'application/x-signlite-asset';
const MIN_PLACEMENT_PX = 24;

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function parseDragAsset(event: DragEvent<HTMLDivElement>): DragAssetPayload | null {
  const raw = event.dataTransfer.getData(ASSET_DRAG_TYPE);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof payload.id !== 'string' ||
      (payload.kind !== 'signature' && payload.kind !== 'initials') ||
      typeof payload.width !== 'number' ||
      typeof payload.height !== 'number'
    ) {
      return null;
    }
    return {
      id: payload.id,
      kind: payload.kind,
      width: payload.width,
      height: payload.height
    };
  } catch {
    return null;
  }
}

export function PlacementLayer({
  documentId,
  pageIndex,
  pageSize,
  placements,
  scale,
  selectedPlacementId,
  onToast,
  onAnnouncePlacement
}: PlacementLayerProps) {
  const addPlacement = useSessionStore((state) => state.addPlacement);
  const updatePlacement = useSessionStore((state) => state.updatePlacement);
  const removePlacement = useSessionStore((state) => state.removePlacement);
  const setSelection = useSessionStore((state) => state.setSelection);

  useEffect(() => {
    const selectedPlacement = placements.find((placement) => placement.id === selectedPlacementId);
    if (!selectedPlacement) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      const deltaX = step / (pageSize.w * scale);
      const deltaY = step / (pageSize.h * scale);

      if (event.key === 'Escape') {
        setSelection(documentId, null);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removePlacement(documentId, selectedPlacement.id);
        return;
      }

      if (!event.key.startsWith('Arrow')) {
        return;
      }

      event.preventDefault();
      const next = clampRect(
        {
          ...selectedPlacement,
          x:
            event.key === 'ArrowLeft'
              ? selectedPlacement.x - deltaX
              : event.key === 'ArrowRight'
                ? selectedPlacement.x + deltaX
                : selectedPlacement.x,
          y:
            event.key === 'ArrowUp'
              ? selectedPlacement.y - deltaY
              : event.key === 'ArrowDown'
                ? selectedPlacement.y + deltaY
                : selectedPlacement.y
        },
        {
          minW: MIN_PLACEMENT_PX / (pageSize.w * scale),
          minH: MIN_PLACEMENT_PX / (pageSize.h * scale)
        }
      );
      updatePlacement(documentId, selectedPlacement.id, next);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [documentId, pageSize.h, pageSize.w, placements, removePlacement, scale, selectedPlacementId, setSelection, updatePlacement]);

  const placeAsset = async (event: DragEvent<HTMLDivElement>) => {
    const asset = parseDragAsset(event);
    if (!asset) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const width = 0.2;
    const naturalHeight = width * (asset.height / asset.width) * (pageSize.w / pageSize.h);
    const minHeight = MIN_PLACEMENT_PX / (pageSize.h * scale);
    const height = Math.max(minHeight, Math.min(naturalHeight, 0.5));
    const normalized = screenToNormalized(
      {
        x: event.clientX - bounds.left - (pageSize.w * scale * width) / 2,
        y: event.clientY - bounds.top - (pageSize.h * scale * height) / 2,
        w: pageSize.w * scale * width,
        h: pageSize.h * scale * height
      },
      pageSize,
      scale,
      1,
      {
        minW: MIN_PLACEMENT_PX / (pageSize.w * scale),
        minH: minHeight
      }
    );

    const placementId = crypto.randomUUID();

    addPlacement(documentId, {
      id: placementId,
      type: asset.kind,
      assetId: asset.id,
      pageIndex,
      ...normalized
    });

    void getAsset(asset.id).then((fullAsset) => {
      if (!fullAsset) return;
      updatePlacement(documentId, placementId, { assetPngBytes: fullAsset.pngBytes.slice(0) });
    });
    await touchAsset(asset.id);
    onAnnouncePlacement?.(asset.kind, pageIndex);
    onToast?.(STRINGS.announcements.placedOnPage(asset.kind === 'signature' ? 'Signature' : 'Initials', pageIndex + 1));
  };

  return (
    <div
      data-testid="placement-layer"
      className="absolute inset-0 z-10"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          setSelection(documentId, null);
        }
      }}
      onDragOver={(event) => {
        if (parseDragAsset(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        void placeAsset(event);
      }}
    >
      {placements.map((placement) => (
        <PlacedElement
          key={placement.id}
          documentId={documentId}
          pageSize={pageSize}
          placement={placement}
          scale={scale}
          selected={placement.id === selectedPlacementId}
        />
      ))}
    </div>
  );
}

export { ASSET_DRAG_TYPE };
