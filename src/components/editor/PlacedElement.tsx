import { format } from 'date-fns';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Placement } from '../../db/schema';
import { getAsset, getDateFormat, setDateFormat } from '../../db/signatures';
import { bufferToObjectUrl } from '../library/canvas';
import { clampRect, normalizedToScreen, screenToNormalized } from '../../pdf/coords';
import { ensureTextFontFamily, layoutText, TEXT_PADDING, type TextLayout } from '../../pdf/textLayout';
import { selectEditingBlocked, useSessionStore } from '../../stores/session';
import { placementLabel } from '../../lib/placements';
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

/** Renders text with the same lines, font, padding, and line boxes the export
 *  draws. Falls back to the plain span until the bundled font and metrics have
 *  loaded, so the box never renders empty mid-load. */
function PlacedTextBody({ text, fontSize, boxW, boxH }: { text: string; fontSize: number; boxW: number; boxH: number }) {
  const [layout, setLayout] = useState<(TextLayout & { family: string }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const family = await ensureTextFontFamily();
      const next = await layoutText(text, {
        fontSize,
        maxWidthPx: Math.max(boxW - TEXT_PADDING.x * 2, fontSize),
        maxHeightPx: Math.max(boxH - TEXT_PADDING.y * 2, fontSize)
      });
      if (!cancelled) setLayout({ ...next, family });
    })();
    return () => {
      cancelled = true;
    };
  }, [boxH, boxW, fontSize, text]);

  const size = Math.max(8, fontSize);
  if (!layout) {
    return (
      <span className="pointer-events-none block h-full w-full overflow-hidden px-2 py-1 text-ink" style={{ fontSize: `${size}px`, lineHeight: 1.2 }}>
        {text}
      </span>
    );
  }
  return (
    <span
      className="pointer-events-none block h-full w-full overflow-hidden px-2 py-1 text-ink"
      style={{ fontFamily: `"${layout.family}", sans-serif`, fontSize: `${size}px`, lineHeight: `${layout.lineHeightPx}px`, whiteSpace: 'pre' }}
    >
      {layout.lines.map((line, index) => (
        <span key={index} className="block" style={{ height: `${layout.lineHeightPx}px`, whiteSpace: 'pre' }}>
          {line.text}
        </span>
      ))}
    </span>
  );
}

export function PlacedElement({ documentId, pageSize, placement, scale, selected, onToast }: PlacedElementProps) {
  const updatePlacement = useSessionStore((state) => state.updatePlacement);
  const snapshotBytes = useSessionStore((state) =>
    placement.snapshotId ? state.session.signatureSnapshots?.[placement.snapshotId]?.pngBytes : undefined
  );
  const removePlacement = useSessionStore((state) => state.removePlacement);
  const duplicatePlacement = useSessionStore((state) => state.duplicatePlacement);
  const copyPlacement = useSessionStore((state) => state.copyPlacement);
  const setSelection = useSessionStore((state) => state.setSelection);
  const mutationLocked = useSessionStore(selectEditingBlocked);
  const [src, setSrc] = useState('');
  const [dateFormatValue, setDateFormatValue] = useState(() => getDateFormat());
  const [isEditingText, setIsEditingText] = useState(false);
  const pointerStateRef = useRef<PointerState | null>(null);
  const stopGestureRef = useRef<(() => void) | null>(null);
  // One coalesce key per gesture so WorkSessionEditor creates one undo entry.
  const gestureKeyRef = useRef('');
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => stopGestureRef.current?.(), []);
  useEffect(() => {
    if (mutationLocked) stopGestureRef.current?.();
  }, [mutationLocked]);

  const screenRect = useMemo(() => normalizedToScreen(placement, pageSize, scale), [pageSize, placement, scale]);

  useEffect(() => {
    let url = '';
    let cancelled = false;
    void (async () => {
      let pngBytes: ArrayBuffer | undefined;
      if (placement.snapshotId) {
        // Modern Placements resolve exclusively from the Work Session snapshot pool.
        pngBytes = snapshotBytes;
      } else {
        // Legacy Placements resolve from the live library, then embedded bytes.
        const legacyAsset = placement.assetId ? await getAsset(placement.assetId) : null;
        pngBytes = legacyAsset?.pngBytes ?? placement.assetPngBytes;
      }
      if (!pngBytes || cancelled) return;
      url = bufferToObjectUrl(pngBytes);
      setSrc(url);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [placement.assetId, placement.assetPngBytes, placement.snapshotId, snapshotBytes]);

  useEffect(() => {
    if (mutationLocked) {
      setIsEditingText(false);
      return;
    }
    if (selected && isEditingText) {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }
  }, [isEditingText, mutationLocked, selected]);

  const displayValue =
    placement.type === 'date'
      ? format(new Date(), placement.value || dateFormatValue)
      : (placement.value ?? (placement.type === 'text' ? 'Text' : ''));

  const minClamp = useMemo(
    () => ({ minW: MIN_PLACEMENT_PX / (pageSize.w * scale), minH: MIN_PLACEMENT_PX / (pageSize.h * scale) }),
    [pageSize.h, pageSize.w, scale]
  );

  const commitRect = (nextRect: { x: number; y: number; w: number; h: number }) => {
    updatePlacement(documentId, placement.id, screenToNormalized(nextRect, pageSize, scale, 1, minClamp), gestureKeyRef.current || undefined, 'gesture');
  };

  const handlePointerMove = (event: PointerEvent) => {
    const pointerState = pointerStateRef.current;
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;

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
      updatePlacement(documentId, placement.id, nextNormalized, gestureKeyRef.current || undefined, 'gesture');
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
    stopGestureRef.current?.();
  };

  const startPointer = (event: ReactPointerEvent, mode: PointerState['mode'], handle?: ResizeHandle) => {
    if (pointerStateRef.current || event.button > 0) return;
    if (mode === 'move' && event.target instanceof HTMLElement && event.target.closest('input, button')) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection(documentId, placement.id);
    if (mutationLocked) return;
    gestureKeyRef.current = `gesture-${placement.id}-${Date.now()}`;
    pointerStateRef.current =
      mode === 'move'
        ? { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: screenRect }
        : { mode, handle: handle ?? 'se', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: screenRect };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    const target = event.currentTarget;
    const lostCapture = () => stopGestureRef.current?.();
    target.setPointerCapture?.(event.pointerId);
    target.addEventListener('lostpointercapture', lostCapture);
    stopGestureRef.current = () => {
      pointerStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      target.removeEventListener('lostpointercapture', lostCapture);
      if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
      stopGestureRef.current = null;
    };
  };

  const cycleDateFormat = async () => {
    if (mutationLocked) return;
    const current = placement.value || dateFormatValue;
    const index = DATE_FORMATS.indexOf(current as (typeof DATE_FORMATS)[number]);
    const next = DATE_FORMATS[(index + 1 + DATE_FORMATS.length) % DATE_FORMATS.length];
    updatePlacement(documentId, placement.id, { value: next }, `date-cycle:${placement.id}`);
    setDateFormatValue(next);
    await setDateFormat(next);
  };

  return (
    <div className={`absolute ${selected ? 'z-20' : 'z-10'}`} style={{ left: screenRect.x, top: screenRect.y, width: screenRect.w, height: screenRect.h }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={placementLabel(placement.type)}
        aria-disabled={mutationLocked}
        // The placement border is chrome and must not inset the content: a
        // 1px border here made the preview's visible marker smaller than the
        // box the export letterboxes into.
        className={`focus-ring group relative flex h-full w-full touch-none items-center justify-center overflow-visible ${
          selected ? 'shadow-[0_0_0_2px_#EFEEE8]' : ''
        } ${placement.type === 'signature' || placement.type === 'initials' ? 'bg-transparent' : 'bg-surface/85'}`}
        onPointerDown={(event) => startPointer(event, 'move')}
        onClick={(event) => {
          event.stopPropagation();
          const wasSelected = selected;
          setSelection(documentId, placement.id);
          if (!mutationLocked && placement.type === 'date' && wasSelected) {
            void cycleDateFormat();
          }
        }}
        onDoubleClick={() => {
          if (!mutationLocked && placement.type === 'text') {
            setIsEditingText(true);
          }
        }}
      >
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 border ${
            selected ? 'border-accent' : 'border-transparent group-hover:border-accent'
          }`}
        />
        {placement.type === 'signature' || placement.type === 'initials' ? (
          src ? <img src={src} alt={placement.type} className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false} /> : null
        ) : placement.type === 'text' && selected && isEditingText ? (
          <input
            ref={textInputRef}
            aria-label="Element text"
            value={placement.value ?? ''}
            disabled={mutationLocked}
            onChange={(event) => {
              if (mutationLocked) return;
              updatePlacement(documentId, placement.id, { value: event.target.value }, `text:${placement.id}`);
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
          <PlacedTextBody
            text={displayValue}
            fontSize={placement.fontSize ?? 12}
            boxW={placement.w * pageSize.w}
            boxH={placement.h * pageSize.h}
          />
        )}

        {selected ? createPortal(
          <div
            role="toolbar"
            aria-label="Selected element"
            className="placement-toolbar editor-placement-toolbar flex items-center gap-1 whitespace-nowrap rounded-lg border border-line bg-surface p-1.5 text-caption shadow-panel"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <strong className="rounded-md bg-accent-subtle px-2 py-1 font-medium text-ink">{placementLabel(placement.type)}</strong>
            <div role="group" aria-label="Element actions" className="flex items-center gap-1 border-l border-line pl-1">
            {placement.type === 'text' ? (
              <button
                type="button"
                className="focus-ring rounded-md px-2 py-1.5 hover:bg-mist disabled:opacity-50"
                disabled={mutationLocked}
                onClick={() => setIsEditingText(true)}
              >
                {STRINGS.buttons.edit}
              </button>
            ) : placement.type === 'date' ? (
              <button
                type="button"
                className="focus-ring rounded-md px-2 py-1.5 hover:bg-mist disabled:opacity-50"
                disabled={mutationLocked}
                onClick={() => void cycleDateFormat()}
              >
                Cycle format
              </button>
            ) : null}
            {placement.type === 'text' || placement.type === 'date' ? (
              <label className="flex items-center gap-1 px-1 text-quiet">
                <span>Size</span>
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={placement.fontSize ?? 12}
                  disabled={mutationLocked}
                  onChange={(event) => {
                    updatePlacement(documentId, placement.id, { fontSize: Number(event.target.value) || 12 }, `fontSize:${placement.id}`);
                  }}
                  className="focus-ring w-14 rounded-md border border-line bg-mist px-1.5 py-1 text-ink disabled:opacity-50"
                />
              </label>
            ) : null}
            <button
              type="button"
              className="focus-ring rounded-md px-2 py-1.5 hover:bg-mist disabled:opacity-50"
              disabled={mutationLocked}
              onClick={() => duplicatePlacement(documentId, placement.id)}
            >
              {STRINGS.buttons.duplicate}
            </button>
            <button
              type="button"
              className="focus-ring rounded-md px-2 py-1.5 hover:bg-mist"
              onClick={() => {
                copyPlacement(documentId, placement.id);
                onToast?.(STRINGS.editor.copiedHint);
              }}
            >
              {STRINGS.buttons.copy}
            </button>
            </div>
            <div role="group" aria-label="Selection actions" className="flex items-center gap-1 border-l border-line pl-1">
              <button
                type="button"
                className="focus-ring rounded-md px-2 py-1.5 text-quiet hover:bg-mist"
                onClick={() => setSelection(documentId, null)}
              >
                Deselect
              </button>
            </div>
            <div role="group" aria-label="Delete element" className="ml-1 border-l border-line pl-2">
            <button
              type="button"
              className="focus-ring rounded-md border border-danger/20 bg-danger/5 px-2 py-1.5 text-danger hover:bg-danger/10 disabled:opacity-50"
              disabled={mutationLocked}
              onClick={() => removePlacement(documentId, placement.id)}
            >
              {STRINGS.buttons.delete}
            </button>
            </div>
          </div>, document.body
        ) : null}

        {selected && (
          <>
            {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${handle}`}
                disabled={mutationLocked}
                className={`placement-resize absolute h-2 w-2 touch-none border border-accent bg-surface ${handle.includes('n') ? '-top-1' : '-bottom-1'} ${handle.includes('w') ? '-left-1' : '-right-1'}`}
                onPointerDown={(event) => startPointer(event, 'resize', handle)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
