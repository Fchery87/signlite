import { useEffect, useMemo, useState } from 'react';
import { saveAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button, Modal } from '../ui';
import { canvasToPngBytes, renderTypedTextToCanvas } from './canvas';

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

export function TypePad({ open, onClose, onSaved, onToast }: TypePadProps) {
  const [kind, setKind] = useState<'signature' | 'initials'>('signature');
  const [value, setValue] = useState('');
  const [font, setFont] = useState<string>(fontOptions[0]?.value ?? 'cursive');

  useEffect(() => {
    if (!open) {
      setKind('signature');
      setValue('');
      setFont(fontOptions[0]?.value ?? 'cursive');
    }
  }, [open]);

  const previewCanvas = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return renderTypedTextToCanvas(trimmed, font, kind);
  }, [font, kind, value]);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    try {
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
            {previewCanvas ? (
              <img
                src={previewCanvas.toDataURL('image/png')}
                alt={STRINGS.library.typedPreviewAlt}
                className="max-h-24 max-w-full object-contain"
              />
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
