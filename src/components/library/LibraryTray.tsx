import { useEffect, useMemo, useRef, useState } from 'react';
import type { SignatureAsset } from '../../db/schema';
import { deleteAsset, listAssets, touchAsset, updateAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button, Modal } from '../ui';
import { DrawPad } from './DrawPad';
import { TypePad } from './TypePad';
import { ImportExport } from './ImportExport';
import { bufferToObjectUrl } from './canvas';
import { uploadSignatureFile } from './uploadSignatureFile';
import { ASSET_DRAG_TYPE } from '../editor/PlacementLayer';

type LibraryTrayProps = {
  onToast: (message: string) => void;
  onAddDate?: () => void;
  onAddText?: () => void;
  onStampDate?: () => void;
  onStampText?: () => void;
  onPlaceAsset?: (asset: SignatureAsset) => void;
  onArmAsset?: (asset: SignatureAsset) => void;
  onStampEveryPage?: (asset: SignatureAsset) => void;
  activePage?: number;
  placementDisabled?: boolean;
};

export function LibraryTray({ onToast, onAddDate, onAddText, onStampDate, onStampText, onPlaceAsset, onArmAsset, onStampEveryPage, activePage = 0, placementDisabled = false }: LibraryTrayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<SignatureAsset[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SignatureAsset | null>(null);

  const refreshAssets = async () => {
    setAssets(await listAssets());
  };

  useEffect(() => {
    void refreshAssets();
  }, []);

  const groupedAssets = useMemo(
    () => ({
      signatures: assets.filter((asset) => asset.kind === 'signature'),
      initials: assets.filter((asset) => asset.kind === 'initials')
    }),
    [assets]
  );

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    const result = await uploadSignatureFile(file);
    await refreshAssets();
    onToast(result.ok ? STRINGS.library.imageSaved : result.message);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleRename = async (asset: SignatureAsset) => {
    const nextLabel = renameValue.trim();
    if (!nextLabel) {
      setRenamingId(null);
      setRenameValue('');
      return;
    }
    await updateAsset(asset.id, { label: nextLabel, lastUsedAt: Date.now() });
    await refreshAssets();
    setRenamingId(null);
    setRenameValue('');
    onToast(STRINGS.library.renamed);
  };

  const handleUse = async (assetId: string) => {
    await touchAsset(assetId);
    await refreshAssets();
  };

  const handlePlace = async (asset: SignatureAsset) => {
    await handleUse(asset.id);
    onPlaceAsset?.(asset);
  };

  const handleStamp = async (asset: SignatureAsset) => {
    await handleUse(asset.id);
    onStampEveryPage?.(asset);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 text-ink">{STRINGS.library.title}</h2>
          <p className="mt-1 text-caption text-quiet">{STRINGS.library.subtitle}</p>
          <p className="mt-2 text-caption text-quiet">{STRINGS.library.storedLocal}</p>
        </div>
        <Button variant="secondary" className="shrink-0 whitespace-nowrap px-2 text-caption" aria-label={STRINGS.library.addMenu} aria-expanded={createOpen || assets.length === 0} onClick={() => setCreateOpen((value) => !value)}>+ New</Button>
      </div>

      {createOpen || assets.length === 0 ? (
        <div className="mt-4 rounded-md bg-mist p-3">
          <p className="mb-2 text-caption font-medium text-ink">Create a signature or initials</p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" onClick={() => { setDrawOpen(true); setCreateOpen(false); }}>{STRINGS.library.draw}</Button>
            <Button variant="secondary" onClick={() => { setTypeOpen(true); setCreateOpen(false); }}>{STRINGS.library.type}</Button>
            <Button variant="secondary" onClick={() => { inputRef.current?.click(); setCreateOpen(false); }}>{STRINGS.library.upload}</Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="text-caption font-medium text-quiet">Add to this document</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onAddDate} disabled={placementDisabled} title="Add a date field">
          {STRINGS.library.date}
        </Button>
        <Button variant="secondary" onClick={onAddText} disabled={placementDisabled} title="Add a text field">
          {STRINGS.library.text}
        </Button>
        </div>
        <details className="mt-2">
          <summary className="focus-ring w-fit cursor-pointer rounded py-1 text-caption text-quiet">Repeat on every page</summary>
          <div className="mt-2 grid gap-2">
        <Button variant="secondary" onClick={onStampDate} disabled={placementDisabled || !onStampDate}>
          {STRINGS.buttons.placeDateOnEveryPage}
        </Button>
        <Button variant="secondary" onClick={onStampText} disabled={placementDisabled || !onStampText}>
          {STRINGS.buttons.placeTextOnEveryPage}
        </Button>
        </div>
        </details>
      </div>

      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg"
        onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
      />

      <div className="mt-4 flex-1 space-y-4 overflow-auto pr-1">
        {assets.length === 0 ? (
          <div className="border border-dashed border-line bg-mist/40 p-4">
            <p className="text-body text-quiet">{STRINGS.library.empty}</p>
          </div>
        ) : (
          <>
            <AssetGroup
              title={STRINGS.library.signatures}
              assets={groupedAssets.signatures}
              activePage={activePage}
              placementDisabled={placementDisabled}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onRenameStart={(asset) => {
                setRenamingId(asset.id);
                setRenameValue(asset.label);
              }}
              onRenameCancel={() => {
                setRenamingId(null);
                setRenameValue('');
              }}
              onRenameSave={handleRename}
              onDelete={setDeleteTarget}
              onUse={handleUse}
              onArm={onArmAsset}
              onPlace={handlePlace}
              onStamp={handleStamp}
              stampDisabled={placementDisabled || !onStampEveryPage}
            />
            <AssetGroup
              title={STRINGS.library.initials}
              assets={groupedAssets.initials}
              activePage={activePage}
              placementDisabled={placementDisabled}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onRenameStart={(asset) => {
                setRenamingId(asset.id);
                setRenameValue(asset.label);
              }}
              onRenameCancel={() => {
                setRenamingId(null);
                setRenameValue('');
              }}
              onRenameSave={handleRename}
              onDelete={setDeleteTarget}
              onUse={handleUse}
              onArm={onArmAsset}
              onPlace={handlePlace}
              onStamp={handleStamp}
              stampDisabled={placementDisabled || !onStampEveryPage}
            />
          </>
        )}
      </div>

      <details className="mt-4 border-t border-line pt-3">
        <summary className="focus-ring cursor-pointer rounded py-1 text-caption font-medium text-quiet">Advanced tools and backup</summary>
        <div className="mt-3 space-y-2"><ImportExport onImported={() => void refreshAssets()} onToast={onToast} /><p className="text-caption text-quiet">{STRINGS.library.backupPlaintext}</p></div>
      </details>

      <DrawPad open={drawOpen} onClose={() => setDrawOpen(false)} onSaved={() => void refreshAssets()} onToast={onToast} />
      <TypePad open={typeOpen} onClose={() => setTypeOpen(false)} onSaved={() => void refreshAssets()} onToast={onToast} />
      <Modal open={Boolean(deleteTarget)} title={STRINGS.library.deleteTitle} onClose={() => setDeleteTarget(null)}>
        <div className="space-y-4">
          <p className="text-body text-quiet">{STRINGS.library.deleteBody}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {STRINGS.buttons.cancel}
            </Button>
            <Button
              onClick={() => {
                if (!deleteTarget) return;
                void deleteAsset(deleteTarget.id).then(async () => {
                  setDeleteTarget(null);
                  await refreshAssets();
                  onToast(STRINGS.library.deleted);
                });
              }}
            >
              {STRINGS.buttons.delete}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

type AssetGroupProps = {
  title: string;
  assets: SignatureAsset[];
  activePage: number;
  placementDisabled: boolean;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameStart: (asset: SignatureAsset) => void;
  onRenameCancel: () => void;
  onRenameSave: (asset: SignatureAsset) => void;
  onDelete: (asset: SignatureAsset) => void;
  onUse: (assetId: string) => void;
  onArm?: (asset: SignatureAsset) => void;
  onPlace: (asset: SignatureAsset) => void;
  onStamp: (asset: SignatureAsset) => void;
  stampDisabled: boolean;
};

function AssetGroup({
  title,
  assets,
  activePage,
  placementDisabled,
  renamingId,
  renameValue,
  onRenameValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSave,
  onDelete,
  onUse,
  onArm,
  onPlace,
  onStamp,
  stampDisabled
}: AssetGroupProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-caption font-medium text-quiet">{title}</h3>
        <span className="text-caption text-quiet">{assets.length}</span>
      </div>
      <div className="space-y-3">
        {assets.length === 0 ? (
          <p className="surface-card bg-mist/20 p-3 text-body text-quiet">{STRINGS.library.emptyGroup(title)}</p>
        ) : (
          assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              activePage={activePage}
              placementDisabled={placementDisabled}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onRenameStart={onRenameStart}
              onRenameCancel={onRenameCancel}
              onRenameSave={onRenameSave}
              onDelete={onDelete}
              onUse={onUse}
              onArm={onArm}
              onPlace={onPlace}
              onStamp={onStamp}
              stampDisabled={stampDisabled}
            />
          ))
        )}
      </div>
    </section>
  );
}

type AssetCardProps = {
  asset: SignatureAsset;
  activePage: number;
  placementDisabled: boolean;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameStart: (asset: SignatureAsset) => void;
  onRenameCancel: () => void;
  onRenameSave: (asset: SignatureAsset) => void;
  onDelete: (asset: SignatureAsset) => void;
  onUse: (assetId: string) => void;
  onArm?: (asset: SignatureAsset) => void;
  onPlace: (asset: SignatureAsset) => void;
  onStamp: (asset: SignatureAsset) => void;
  stampDisabled: boolean;
};

function AssetCard({
  asset,
  activePage,
  placementDisabled,
  renamingId,
  renameValue,
  onRenameValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSave,
  onDelete,
  onUse,
  onArm,
  onPlace,
  onStamp,
  stampDisabled
}: AssetCardProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const url = bufferToObjectUrl(asset.pngBytes);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [asset.pngBytes]);

  const isRenaming = renamingId === asset.id;

  return (
    <article className="rounded-lg border border-line bg-surface p-3">
      <button
        className="focus-ring w-full rounded-md bg-mist p-3 disabled:cursor-not-allowed"
        type="button"
        disabled={placementDisabled}
        draggable={!placementDisabled}
        onDragStart={(event) => {
          if (placementDisabled) { event.preventDefault(); return; }
          event.dataTransfer.setData(
            ASSET_DRAG_TYPE,
            JSON.stringify({ id: asset.id, kind: asset.kind, width: asset.width, height: asset.height })
          );
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => { void onUse(asset.id); onArm?.(asset); }}
      >
        {src ? <img src={src} alt={asset.label} draggable={false} className="pointer-events-none mx-auto max-h-20 max-w-full object-contain" /> : null}
      </button>
      <div className="mt-3">
        {isRenaming ? (
          <div className="space-y-2">
            <input
              value={renameValue}
              onChange={(event) => onRenameValueChange(event.target.value)}
              className="focus-ring w-full border border-line px-3 py-2 text-body"
            />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onRenameCancel}>
                {STRINGS.buttons.cancel}
              </Button>
              <Button className="flex-1" onClick={() => onRenameSave(asset)}>
                {STRINGS.buttons.save}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-body font-medium text-ink">{asset.label}</p>
            <p className="mt-1 text-caption text-quiet">Choose the preview, then click or tap the PDF.</p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <Button className="w-full" aria-label={STRINGS.library.placeOnPage(activePage + 1)} onClick={() => void onPlace(asset)} disabled={placementDisabled}>
                {STRINGS.buttons.place}
              </Button>
            </div>
            <details className="mt-2">
              <summary className="focus-ring w-fit cursor-pointer rounded py-1 text-caption text-quiet">Manage asset</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" className="px-2 text-caption" onClick={() => onRenameStart(asset)}>
                Rename
              </Button>
              <Button variant="secondary" className="px-2 text-caption" onClick={() => onDelete(asset)}>
                {STRINGS.buttons.delete}
              </Button>
              </div>
            <Button
              variant="secondary" className="mt-2 w-full px-2 text-caption"
              onClick={() => void onStamp(asset)}
              disabled={placementDisabled || stampDisabled}
            >
              {STRINGS.buttons.placeOnEveryPage}
            </Button>
            </details>
          </>
        )}
      </div>
    </article>
  );
}
