import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { saveAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button, Modal } from '../ui';
import { canvasToPngBytes, renderStrokes, trimCanvas, type DrawStroke } from './canvas';

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
  const draftStrokeRef = useRef<DrawStroke | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderStrokes(canvas, strokes);
  }, [strokes]);

  useEffect(() => {
    if (!open) {
      setKind('signature');
      setStrokes([]);
    }
  }, [open]);

  const label = useMemo(() => (kind === 'signature' ? 'Signature' : 'Initials'), [kind]);

  const toCanvasPoint = (event: PointerEvent | ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    return {
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(event);
    if (!point) return;
    drawingRef.current = true;
    draftStrokeRef.current = [point];
    event.currentTarget.setPointerCapture(event.pointerId);
    setStrokes((current) => [...current, [point]]);
  };

  const extendStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !draftStrokeRef.current) return;
    const point = toCanvasPoint(event);
    if (!point) return;
    draftStrokeRef.current = [...draftStrokeRef.current, point];
    setStrokes((current) => {
      if (current.length === 0) return current;
      return [...current.slice(0, -1), draftStrokeRef.current as DrawStroke];
    });
  };

  const finishStroke = () => {
    drawingRef.current = false;
    draftStrokeRef.current = null;
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
      onToast(kind === 'signature' ? STRINGS.library.drawSaved : STRINGS.library.initialsSaved);
      onClose();
    } catch (error) {
      if (error instanceof Error && error.message === STRINGS.errors.quota) {
        onSaved();
        onToast(error.message);
        onClose();
        return;
      }
      onToast(error instanceof Error ? error.message : STRINGS.library.saveFailed);
    }
  };

  return (
    <Modal open={open} title={kind === 'signature' ? STRINGS.library.drawTitle : 'Draw initials'} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant={kind === 'signature' ? 'primary' : 'secondary'} onClick={() => setKind('signature')}>
            {STRINGS.library.signatures.slice(0, -1)}
          </Button>
          <Button variant={kind === 'initials' ? 'primary' : 'secondary'} onClick={() => setKind('initials')}>
            {STRINGS.library.initials}
          </Button>
        </div>
        <div className="rounded-2xl border border-line bg-mist/60 p-3">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="h-[250px] w-full touch-none rounded-xl bg-white"
            onPointerDown={startStroke}
            onPointerMove={extendStroke}
            onPointerUp={finishStroke}
            onPointerLeave={finishStroke}
            onPointerCancel={finishStroke}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-3">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setStrokes((current) => current.slice(0, -1))}
              disabled={strokes.length === 0}
            >
              Undo
            </Button>
            <Button variant="secondary" onClick={() => setStrokes([])} disabled={strokes.length === 0}>
              Clear
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {STRINGS.buttons.cancel}
            </Button>
            <Button onClick={() => void handleSave()} disabled={strokes.length === 0}>
              {STRINGS.buttons.save}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
