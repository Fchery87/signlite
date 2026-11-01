import { useEffect, useRef, useState } from 'react';
import type { SignatureAsset } from '../../db/schema';
import { touchAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { bufferToObjectUrl } from '../library/canvas';
import { DrawPad } from '../library/DrawPad';
import { TypePad } from '../library/TypePad';
import { uploadSignatureFile } from '../library/uploadSignatureFile';
import { Button, Modal } from '../ui';

type SignatureDockProps = {
  assets: SignatureAsset[];
  selected: SignatureAsset | null;
  onSelect: (assetId: string) => void;
  onRefresh: () => Promise<void>;
  onToast: (message: string) => void;
};

function SignaturePreview({ asset, className = '' }: { asset: SignatureAsset; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = bufferToObjectUrl(asset.pngBytes);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [asset]);

  return url ? <img src={url} alt={asset.label} className={className} /> : null;
}

export function SignatureDock({ assets, selected, onSelect, onRefresh, onToast }: SignatureDockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const choose = async (assetId: string) => {
    onSelect(assetId);
    setChooseOpen(false);
    await touchAsset(assetId);
  };

  const upload = async (file: File | null) => {
    if (!file) return;
    const result = await uploadSignatureFile(file);
    if (!result.ok) {
      onToast(result.message);
      if (uploadRef.current) uploadRef.current.value = '';
      return;
    }
    onSelect(result.asset.id);
    await onRefresh();
    onToast(STRINGS.library.imageSaved);
    if (uploadRef.current) uploadRef.current.value = '';
  };

  return (
    <aside className="surface-card p-4" aria-label={STRINGS.queue.signatureTitle}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 text-ink">{STRINGS.queue.signatureTitle}</h2>
          <p className="mt-1 text-caption leading-5 text-quiet">{STRINGS.queue.signatureSubtitle}</p>
        </div>
        <div className="relative">
          <Button variant="secondary" aria-label={STRINGS.queue.createSignature} onClick={() => setMenuOpen((open) => !open)}>
            +
          </Button>
          {menuOpen && (
            <div className="surface-card absolute right-0 z-20 mt-2 w-36 p-2 shadow-panel">
              <Button className="w-full justify-start" variant="ghost" onClick={() => { setDrawOpen(true); setMenuOpen(false); }}>
                {STRINGS.queue.draw}
              </Button>
              <Button className="mt-1 w-full justify-start" variant="ghost" onClick={() => { setTypeOpen(true); setMenuOpen(false); }}>
                {STRINGS.queue.type}
              </Button>
              <Button className="mt-1 w-full justify-start" variant="ghost" onClick={() => { uploadRef.current?.click(); setMenuOpen(false); }}>
                {STRINGS.queue.upload}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-h-[92px] items-center justify-center border border-line bg-surface px-4 py-3">
        {selected ? (
          <SignaturePreview asset={selected} className="max-h-14 max-w-full object-contain" />
        ) : (
          <p className="text-caption text-quiet">{STRINGS.queue.signatureEmpty}</p>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        {assets.length > 1 ? (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setChooseOpen(true)}
          >
            {STRINGS.queue.changeSignature}
          </Button>
        ) : null}
        {!selected ? (
          <Button className="flex-1" onClick={() => setMenuOpen(true)}>
            {STRINGS.queue.createSignature}
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-caption text-quiet">{STRINGS.queue.signatureStored}</p>
      <input
        ref={uploadRef}
        hidden
        type="file"
        accept="image/png,image/jpeg"
        onChange={(event) => void upload(event.target.files?.[0] ?? null)}
      />

      <Modal open={chooseOpen} title={STRINGS.queue.chooseSignature} onClose={() => setChooseOpen(false)}>
        <div className="grid gap-2 sm:grid-cols-2">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              aria-pressed={asset.id === selected?.id}
              onClick={() => void choose(asset.id)}
              className={`focus-ring border p-3 text-left transition ${asset.id === selected?.id ? 'border-accent bg-accent-subtle' : 'border-line bg-surface hover:bg-mist'}`}
            >
              <span className="flex min-h-12 items-center justify-center">
                <SignaturePreview asset={asset} className="max-h-12 max-w-full object-contain" />
              </span>
              <span className="mt-2 block truncate text-body font-medium text-ink">{asset.label}</span>
              <span className="mt-0.5 block text-caption capitalize text-quiet">{asset.kind}</span>
            </button>
          ))}
        </div>
      </Modal>

      <DrawPad open={drawOpen} onClose={() => setDrawOpen(false)} onSaved={() => void onRefresh()} onToast={onToast} />
      <TypePad open={typeOpen} onClose={() => setTypeOpen(false)} onSaved={() => void onRefresh()} onToast={onToast} />
    </aside>
  );
}
