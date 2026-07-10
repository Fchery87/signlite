import { format } from 'date-fns';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Placement } from '../../db/schema';
import { getAsset, getDateFormat, setDateFormat } from '../../db/signatures';
import { bufferToObjectUrl } from '../library/canvas';
import { clampRect, normalizedToScreen, screenToNormalized } from '../../pdf/coords';
import { useSessionStore } from '../../stores/session';
import { STRINGS } from '../../lib/strings';

type PageSize = { w: number; h: number };

type PlacedElementProps = {
  documentId: string;
  pageSize: PageSize;
  placement: Placement;
  scale: number;
  selected: boolean;
  onToast?: (message: string) => void;
};

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

type PointerState =
  | { mode: 'move'; pointerId: number; startX: number; startY: number; rect: { x: number; y: number; w: number; h: number } }
  | {
      mode: 'resize';
      handle: ResizeHandle;
      pointerId: number;
      startX: number;
      startY: number;
      rect: { x: number; y: number; w: number; h: number };
    };

const DATE_FORMATS = ['MMM d, yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'] as const;
const MIN_PLACEMENT_PX = 24;

function aspectRatio(rect: { w: number; h: number }) {
  return rect.w / Math.max(rect.h, 0.0001);
}

function normalizeRect(rect: { x: number; y: number; w: number; h: number }) {
  let { x, y, w, h } = rect;
  if (w < 0) {
    x += w;
    w = Math.abs(w);
  }
  if (h < 0) {
    y += h;
    h = Math.abs(h);
  }
  return { x, y, w, h };
}

export function PlacedElement({ documentId, pageSize, placement, scale, selected, onToast }: PlacedElementProps) {
  const updatePlacement = useSessionStore((state) => state.updatePlacement);
  const removePlacement = useSessionStore((state) => state.removePlacement);
  const duplicatePlacement = useSessionStore((state) => state.duplicatePlacement);
  const copyPlacement = useSessionStore((state) => state.copyPlacement);
  const pushHistory = useSessionStore((state) => state.pushHistory);
  const setSelection = useSessionStore((state) => state.setSelection);
  const [src, setSrc] = useState('');
  const [dateFormatValue, setDateFormatValue] = useState(() => getDateFormat());
  const [isEditingText, setIsEditingText] = useState(false);
  const pointerStateRef = useRef<PointerState | null>(null);
  // One history entry per drag/resize gesture, captured before the first move.
  const gestureHistoryPushedRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement>(null);

  const screenRect = useMemo(() => normalizedToScreen(placement, pageSize, scale), [pageSize, placement, scale]);

  useEffect(() => {
    if (!placement.assetId && !placement.assetPngBytes) return;
    let revokedUrl = '';
    let cancelled = false;

    void (async () => {
      const asset = placement.assetId ? await getAsset(placement.assetId) : null;
      const pngBytes = asset?.pngBytes ?? placement.assetPngBytes;
      if (!pngBytes || cancelled) return;
      const url = bufferToObjectUrl(pngBytes);
      revokedUrl = url;
      setSrc(url);
    })();

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [placement.assetId, placement.assetPngBytes]);

  useEffect(() => {
    if (selected && isEditingText) {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }
  }, [isEditingText, selected]);

  const displayValue =
    placement.type === 'date'
      ? format(new Date(), placement.value || dateFormatValue)
      : (placement.value ?? (placement.type === 'text' ? 'Text' : ''));

  const minClamp = useMemo(
    () => ({ minW: MIN_PLACEMENT_PX / (pageSize.w * scale), minH: MIN_PLACEMENT_PX / (pageSize.h * scale) }),
    [pageSize.h, pageSize.w, scale]
  );

  const commitRect = (nextRect: { x: number; y: number; w: number; h: number }) => {
    updatePlacement(documentId, placement.id, screenToNormalized(nextRect, pageSize, scale, 1, minClamp));
  };

  const handlePointerMove = (event: PointerEvent) => {
    const pointerState = pointerStateRef.current;
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;

    if (!gestureHistoryPushedRef.current) {
      gestureHistoryPushedRef.current = true;
      pushHistory();
    }

    const dx = event.clientX - pointerState.startX;
    const dy = event.clientY - pointerState.startY;

    if (pointerState.mode === 'move') {
      const nextNormalized = clampRect(
        screenToNormalized(
          {
            x: pointerState.rect.x + dx,
            y: pointerState.rect.y + dy,
            w: pointerState.rect.w,
            h: pointerState.rect.h
          },
          pageSize,
          scale,
          1,
          minClamp
        ),
        minClamp
      );
      updatePlacement(documentId, placement.id, nextNormalized);
      return;
    }

    let nextRect = { ...pointerState.rect };
    if (pointerState.handle.includes('e')) {
      nextRect.w = pointerState.rect.w + dx;
    }
    if (pointerState.handle.includes('s')) {
      nextRect.h = pointerState.rect.h + dy;
    }
    if (pointerState.handle.includes('w')) {
      nextRect.x = pointerState.rect.x + dx;
      nextRect.w = pointerState.rect.w - dx;
    }
    if (pointerState.handle.includes('n')) {
      nextRect.y = pointerState.rect.y + dy;
      nextRect.h = pointerState.rect.h - dy;
    }

    nextRect = normalizeRect(nextRect);

    if (placement.type === 'signature' || placement.type === 'initials') {
      const ratio = aspectRatio(pointerState.rect);
      if (pointerState.handle === 'nw' || pointerState.handle === 'se') {
        nextRect.h = nextRect.w / ratio;
      } else {
        nextRect.w = nextRect.h * ratio;
      }
      if (pointerState.handle.includes('w')) {
        nextRect.x = pointerState.rect.x + (pointerState.rect.w - nextRect.w);
      }
      if (pointerState.handle.includes('n')) {
        nextRect.y = pointerState.rect.y + (pointerState.rect.h - nextRect.h);
      }
    }

    commitRect(normalizeRect(nextRect));
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!pointerStateRef.current || event.pointerId !== pointerStateRef.current.pointerId) return;
    pointerStateRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  const startPointer = (event: ReactPointerEvent, mode: PointerState['mode'], handle?: ResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection(documentId, placement.id);
    gestureHistoryPushedRef.current = false;
    pointerStateRef.current =
      mode === 'move'
        ? { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: screenRect }
        : { mode, handle: handle ?? 'se', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: screenRect };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const cycleDateFormat = async () => {
    const current = placement.value || dateFormatValue;
    const index = DATE_FORMATS.indexOf(current as (typeof DATE_FORMATS)[number]);
    const next = DATE_FORMATS[(index + 1 + DATE_FORMATS.length) % DATE_FORMATS.length];
    pushHistory();
    updatePlacement(documentId, placement.id, { value: next });
    setDateFormatValue(next);
    await setDateFormat(next);
  };

  return (
    <div className={`absolute ${selected ? 'z-20' : 'z-10'}`} style={{ left: screenRect.x, top: screenRect.y, width: screenRect.w, height: screenRect.h }}>
      <div
        role="button"
        tabIndex={0}
        className={`focus-ring group relative flex h-full w-full items-center justify-center overflow-visible border ${
          selected ? 'border-accent shadow-[0_0_0_2px_#EDF1FC]' : 'border-transparent hover:border-accent'
        } ${placement.type === 'signature' || placement.type === 'initials' ? 'bg-transparent' : 'bg-surface/85'}`}
        onPointerDown={(event) => startPointer(event, 'move')}
        onClick={(event) => {
          event.stopPropagation();
          const wasSelected = selected;
          setSelection(documentId, placement.id);
          if (placement.type === 'date' && wasSelected) {
            void cycleDateFormat();
          }
        }}
        onDoubleClick={() => {
          if (placement.type === 'text') {
            setIsEditingText(true);
          }
        }}
      >
        {placement.type === 'signature' || placement.type === 'initials' ? (
          src ? <img src={src} alt={placement.type} className="pointer-events-none h-full w-full object-contain" draggable={false} /> : null
        ) : placement.type === 'text' && selected && isEditingText ? (
          <input
            ref={textInputRef}
            value={placement.value ?? ''}
            onChange={(event) => {
              pushHistory(`text:${placement.id}`);
              updatePlacement(documentId, placement.id, { value: event.target.value });
            }}
            onBlur={() => setIsEditingText(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setIsEditingText(false);
              }
            }}
            className="h-full w-full border-0 bg-transparent px-2 text-ink outline-none"
            style={{ fontSize: `${placement.fontSize ?? 12}px` }}
          />
        ) : (
          <span className="pointer-events-none block h-full w-full overflow-hidden px-2 py-1 text-ink" style={{ fontSize: `${placement.fontSize ?? 12}px`, lineHeight: 1.2 }}>
            {displayValue}
          </span>
        )}

        {selected ? (
          <div
            className="absolute -top-10 left-0 flex items-center gap-2 border border-line bg-surface px-2 py-1 text-caption shadow-panel"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {placement.type === 'text' ? (
              <button
                type="button"
                className="focus-ring rounded-sm px-2 py-1 hover:bg-mist"
                onClick={() => setIsEditingText(true)}
              >
                {STRINGS.buttons.edit}
              </button>
            ) : placement.type === 'date' ? (
              <button
                type="button"
                className="focus-ring rounded-sm px-2 py-1 hover:bg-mist"
                onClick={() => void cycleDateFormat()}
              >
                Cycle format
              </button>
            ) : null}
            {placement.type === 'text' || placement.type === 'date' ? (
              <label className="flex items-center gap-1">
                <span>Size</span>
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={placement.fontSize ?? 12}
                  onChange={(event) => {
                    pushHistory(`fontSize:${placement.id}`);
                    updatePlacement(documentId, placement.id, { fontSize: Number(event.target.value) || 12 });
                  }}
                  className="focus-ring w-14 border border-line px-1 py-0.5"
                />
              </label>
            ) : null}
            <button
              type="button"
              className="focus-ring rounded-sm px-2 py-1 hover:bg-mist"
              onClick={() => duplicatePlacement(documentId, placement.id)}
            >
              {STRINGS.buttons.duplicate}
            </button>
            <button
              type="button"
              className="focus-ring rounded-sm px-2 py-1 hover:bg-mist"
              onClick={() => {
                copyPlacement(documentId, placement.id);
                onToast?.(STRINGS.editor.copiedHint);
              }}
            >
              {STRINGS.buttons.copy}
            </button>
            <button
              type="button"
              className="focus-ring rounded-sm px-2 py-1 text-danger hover:bg-mist"
              onClick={() => removePlacement(documentId, placement.id)}
            >
              {STRINGS.buttons.delete}
            </button>
          </div>
        ) : null}

        {selected && (
          <>
            {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${handle}`}
                className={`absolute h-2 w-2 border border-accent bg-surface ${handle.includes('n') ? '-top-1' : '-bottom-1'} ${handle.includes('w') ? '-left-1' : '-right-1'}`}
                onPointerDown={(event) => startPointer(event, 'resize', handle)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
