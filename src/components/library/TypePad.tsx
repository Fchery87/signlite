import { useEffect, useState } from 'react';
import { saveAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button, Modal } from '../ui';
import { canvasToPngBytes, ensureFontReady, renderTypedTextToCanvas } from './canvas';

type TypePadProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
};

const fontOptions = [
  { label: 'Caveat', value: '"SignLite Caveat", "Brush Script MT", cursive' },
  { label: 'Homemade Apple', value: '"SignLite Homemade Apple", "Segoe Print", cursive' }
] as const;

type FontState = 'loading' | 'ready' | 'unavailable';

export function TypePad({ open, onClose, onSaved, onToast }: TypePadProps) {
  const [kind, setKind] = useState<'signature' | 'initials'>('signature');
  const [value, setValue] = useState('');
  const [font, setFont] = useState<string>(fontOptions[0]?.value ?? 'cursive');
  const [fontState, setFontState] = useState<FontState>('loading');
  const [preview, setPreview] = useState<{ src: string } | null>(null);
  const [fontCheckTick, setFontCheckTick] = useState(0);

  useEffect(() => {
    if (!open) {
      setKind('signature');
      setValue('');
      setFont(fontOptions[0]?.value ?? 'cursive');
    }
  }, [open]);

  // The preview and the saved PNG must both wait for the bundled font: a
  // fallback typeface would be captured into permanent signature bytes.
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setPreview(null);
      setFontState('loading');
      return;
    }
    let cancelled = false;
    setFontState('loading');
    void (async () => {
      const ready = await ensureFontReady(font, trimmed);
      if (cancelled) return;
      if (!ready) {
        setFontState('unavailable');
        setPreview(null);
        return;
      }
      const canvas = renderTypedTextToCanvas(trimmed, font, kind);
      setPreview({ src: canvas.toDataURL('image/png') });
      setFontState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [font, kind, value, fontCheckTick]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    try {
      // Re-verify at save time: the preview may predate a font that fell back.
      if (!(await ensureFontReady(font, trimmed))) {
        onToast(STRINGS.library.fontNotReady);
        return;
      }
      const canvas = renderTypedTextToCanvas(trimmed, font, kind);
      await saveAsset({
        kind,
        source: 'typed',
        pngBytes: await canvasToPngBytes(canvas),
        width: canvas.width,
        height: canvas.height,
        typedText: trimmed,
        typedFont: font,
        label: trimmed
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

  const retryFontLoad = () => {
    setFontCheckTick((tick) => tick + 1);
  };

  return (
    <Modal open={open} title={kind === 'signature' ? STRINGS.library.typeTitle : 'Type initials'} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant={kind === 'signature' ? 'primary' : 'secondary'} onClick={() => setKind('signature')}>
            {STRINGS.library.signatures.slice(0, -1)}
          </Button>
          <Button variant={kind === 'initials' ? 'primary' : 'secondary'} onClick={() => setKind('initials')}>
            {STRINGS.library.initials}
          </Button>
        </div>
        <label className="block text-sm text-ink">
          <span className="mb-2 block font-medium">Text</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={kind === 'signature' ? STRINGS.library.typeNamePlaceholder : STRINGS.library.typeInitialsPlaceholder}
            className="focus-ring w-full rounded-xl border border-line px-3 py-2"
          />
        </label>
        <label className="block text-sm text-ink">
          <span className="mb-2 block font-medium">Style</span>
          <select value={font} onChange={(event) => setFont(event.target.value)} className="focus-ring w-full rounded-xl border border-line px-3 py-2">
            {fontOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-2xl border border-line bg-mist/60 p-3">
          <div className="flex min-h-28 items-center justify-center rounded-xl bg-white p-4">
            {preview ? (
              <img
                src={preview.src}
                alt={STRINGS.library.typedPreviewAlt}
                className="max-h-24 max-w-full object-contain"
              />
            ) : fontState === 'unavailable' ? (
              <div className="text-center">
                <p className="text-sm text-warning">{STRINGS.library.fontNotReady}</p>
                <Button variant="secondary" className="mt-2" onClick={retryFontLoad}>
                  {STRINGS.library.retryFont}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-quiet">Your preview shows up here.</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {STRINGS.buttons.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={value.trim().length === 0}>
            {STRINGS.buttons.save}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
