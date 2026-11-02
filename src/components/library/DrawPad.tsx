import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { saveAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button, Modal } from '../ui';
import {
  canvasToPngBytes,
  renderStrokes,
  trimCanvas,
  type DrawStroke
} from './canvas';

type DrawPadProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 500;

export function DrawPad({ open, onClose, onSaved, onToast }: DrawPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [kind, setKind] = useState<'signature' | 'initials'>('signature');
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [canvasHeight, setCanvasHeight] = useState(CANVAS_HEIGHT);
  const draftStrokeRef = useRef<DrawStroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const guidanceId = useId();

  const finishStroke = () => {
    const pointerId = activePointerRef.current;
    activePointerRef.current = null;
    draftStrokeRef.current = null;
    if (pointerId !== null) {
      try {
        canvasRef.current?.releasePointerCapture?.(pointerId);
      } catch {
        /* Capture may already be lost. */
      }
    }
  };

  const undo = () => {
    finishStroke();
    setStrokes((current) => current.slice(0, -1));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderStrokes(canvas, strokes);
  }, [strokes, canvasHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !open ||
      !canvas ||
      strokes.length > 0 ||
      typeof ResizeObserver === 'undefined'
    )
      return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setCanvasHeight(
          Math.round((CANVAS_WIDTH * bounds.height) / bounds.width)
        );
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [open, strokes.length]);

  useEffect(() => {
    if (!open) {
      finishStroke();
      setKind('signature');
      setStrokes([]);
    }
  }, [open]);

  useEffect(() => () => finishStroke(), []);

  // Undo the last pen stroke. Without this the shortcut falls through to the
  // editor and undoes the Work Session instead.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z')
        return;
      event.preventDefault();
      event.stopPropagation();
      finishStroke();
      setStrokes((current) => current.slice(0, -1));
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const label = useMemo(
    () => (kind === 'signature' ? 'Signature' : 'Initials'),
    [kind]
  );

  const toCanvasPoint = (
    event: PointerEvent | ReactPointerEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    return {
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY,
      ...(event.pointerType === 'pen' &&
      Number.isFinite(event.pressure) &&
      event.pressure > 0
        ? { pressure: Math.min(1, event.pressure) }
        : {})
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      activePointerRef.current !== null ||
      (event.button != null && event.button !== 0)
    )
      return;
    const point = toCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    draftStrokeRef.current = [point];
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      finishStroke();
      return;
    }
    setStrokes((current) => [...current, [point]]);
  };

  const extendStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId || !draftStrokeRef.current)
      return;
    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (samples.length ? samples : [event])
      .map(toCanvasPoint)
      .filter((point) => point !== null);
    if (!points.length) return;
    // Capture the extended stroke here. React runs this updater at render time, by
    // which point finishStroke (pointerup/leave/cancel, which can land in the same
    // batch as this move) may have already cleared the ref.
    const extended: DrawStroke = [...draftStrokeRef.current, ...points];
    draftStrokeRef.current = extended;
    setStrokes((current) => {
      if (current.length === 0) return current;
      return [...current.slice(0, -1), extended];
    });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    if (event.type === 'pointerup') extendStroke(event);
    finishStroke();
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return;
    const trimmed = trimCanvas(canvas);
    if (!trimmed) return;

    try {
      await saveAsset({
        kind,
        source: 'drawn',
        pngBytes: await canvasToPngBytes(trimmed),
        width: trimmed.width,
        height: trimmed.height,
        strokeData: JSON.stringify(strokes),
        label
      });
      onSaved();
      onToast(
        kind === 'signature'
          ? STRINGS.library.drawSaved
          : STRINGS.library.initialsSaved
      );
      onClose();
    } catch (error) {
      if (error instanceof Error && error.message === STRINGS.errors.quota) {
        onSaved();
        onToast(error.message);
        onClose();
        return;
      }
      onToast(
        error instanceof Error ? error.message : STRINGS.library.saveFailed
      );
    }
  };

  return (
    <Modal
      mobileFullscreen
      open={open}
      title={kind === 'signature' ? STRINGS.library.drawTitle : 'Draw initials'}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={kind === 'signature' ? 'primary' : 'secondary'}
            onClick={() => setKind('signature')}
          >
            {STRINGS.library.signatures.slice(0, -1)}
          </Button>
          <Button
            variant={kind === 'initials' ? 'primary' : 'secondary'}
            onClick={() => setKind('initials')}
          >
            {STRINGS.library.initials}
          </Button>
        </div>
        <div className="rounded-2xl border border-line bg-mist/60 p-3">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={canvasHeight}
            aria-label={`${label} drawing canvas`}
            aria-describedby={guidanceId}
            style={
              strokes.length > 0
                ? {
                    height: 'auto',
                    aspectRatio: `${CANVAS_WIDTH} / ${canvasHeight}`
                  }
                : undefined
            }
            className="aspect-[12/5] h-[clamp(240px,45dvh,440px)] w-full touch-none rounded-xl bg-white sm:h-auto"
            onPointerDown={startStroke}
            onPointerMove={extendStroke}
            onPointerUp={finishPointer}
            onLostPointerCapture={finishPointer}
            onPointerCancel={finishPointer}
          />
        </div>
        <p id={guidanceId} className="text-sm text-slate-600">
          Draw with your finger, stylus, or mouse. Use Undo to remove the last
          stroke.
        </p>
        <div className="flex flex-wrap justify-between gap-3">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={undo}
              disabled={strokes.length === 0}
            >
              Undo
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                finishStroke();
                setStrokes([]);
              }}
              disabled={strokes.length === 0}
            >
              Clear
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {STRINGS.buttons.cancel}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={strokes.length === 0}
            >
              {STRINGS.buttons.save}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
