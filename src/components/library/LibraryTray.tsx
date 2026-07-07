import { useEffect, useMemo, useRef, useState } from 'react';
import type { SignatureAsset } from '../../db/schema';
import { deleteAsset, listAssets, saveAsset, touchAsset, updateAsset } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button, Modal } from '../ui';
import { DrawPad } from './DrawPad';
import { TypePad } from './TypePad';
import { ImportExport } from './ImportExport';
import { bufferToObjectUrl, canvasToPngBytes, imageFileToCanvas } from './canvas';
import { ASSET_DRAG_TYPE } from '../editor/PlacementLayer';

type LibraryTrayProps = {
  onToast: (message: string) => void;
  onAddDate?: () => void;
  onAddText?: () => void;
  onPlaceAsset?: (asset: SignatureAsset) => void;
  activePage?: number;
};

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export function LibraryTray({ onToast, onAddDate, onAddText, onPlaceAsset, activePage = 0 }: LibraryTrayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<SignatureAsset[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
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

    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_UPLOAD_SIZE) {
      onToast(STRINGS.errors[file.size > MAX_UPLOAD_SIZE ? 'upload-too-large' : 'upload-invalid']);
      return;
    }

    try {
      const canvas = await imageFileToCanvas(file);
      await saveAsset({
        kind: 'signature',
        source: 'uploaded',
        pngBytes: await canvasToPngBytes(canvas),
        width: canvas.width,
        height: canvas.height,
        label: file.name.replace(/\.[^.]+$/, '') || 'Uploaded signature'
      });
      await refreshAssets();
      onToast(STRINGS.library.imageSaved);
    } catch (error) {
      if (error instanceof Error && error.message === STRINGS.errors.quota) {
        await refreshAssets();
        onToast(error.message);
      } else {
        onToast(error instanceof Error ? error.message : STRINGS.library.uploadFailed);
      }
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 text-ink">{STRINGS.library.title}</h2>
          <p className="mt-1 text-caption text-quiet">{STRINGS.library.subtitle}</p>
          <p className="mt-2 text-caption text-quiet">{STRINGS.library.storedLocal}</p>
        </div>
        <div className="relative">
          <Button variant="secondary" aria-label={STRINGS.library.addMenu} onClick={() => setMenuOpen((value) => !value)}>
            +
          </Button>
          {menuOpen && (
            <div className="surface-card absolute right-0 z-10 mt-2 w-40 p-2 shadow-panel">
              <Button
                className="w-full justify-start"
                variant="ghost"
                onClick={() => {
                  setDrawOpen(true);
                  setMenuOpen(false);
                }}
              >
                {STRINGS.library.draw}
              </Button>
              <Button
                className="mt-1 w-full justify-start"
                variant="ghost"
                onClick={() => {
                  setTypeOpen(true);
                  setMenuOpen(false);
                }}
              >
                {STRINGS.library.type}
              </Button>
              <Button
                className="mt-1 w-full justify-start"
                variant="ghost"
                onClick={() => {
                  inputRef.current?.click();
                  setMenuOpen(false);
                }}
              >
                {STRINGS.library.upload}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onAddDate}>
          {STRINGS.library.date}
        </Button>
        <Button variant="secondary" onClick={onAddText}>
          {STRINGS.library.text}
        </Button>
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
              onPlace={handlePlace}
            />
            <AssetGroup
              title={STRINGS.library.initials}
              assets={groupedAssets.initials}
              activePage={activePage}
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
              onPlace={handlePlace}
            />
          </>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <ImportExport onImported={() => void refreshAssets()} onToast={onToast} />
        <p className="text-caption text-quiet">{STRINGS.library.backupPlaintext}</p>
      </div>

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
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameStart: (asset: SignatureAsset) => void;
  onRenameCancel: () => void;
  onRenameSave: (asset: SignatureAsset) => void;
  onDelete: (asset: SignatureAsset) => void;
  onUse: (assetId: string) => void;
  onPlace: (asset: SignatureAsset) => void;
};

function AssetGroup({
  title,
  assets,
  activePage,
  renamingId,
  renameValue,
  onRenameValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSave,
  onDelete,
  onUse,
  onPlace
}: AssetGroupProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-caption font-medium uppercase text-quiet">{title}</h3>
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
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onRenameStart={onRenameStart}
              onRenameCancel={onRenameCancel}
              onRenameSave={onRenameSave}
              onDelete={onDelete}
              onUse={onUse}
              onPlace={onPlace}
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
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameStart: (asset: SignatureAsset) => void;
  onRenameCancel: () => void;
  onRenameSave: (asset: SignatureAsset) => void;
  onDelete: (asset: SignatureAsset) => void;
  onUse: (assetId: string) => void;
  onPlace: (asset: SignatureAsset) => void;
};

function AssetCard({
  asset,
  activePage,
  renamingId,
  renameValue,
  onRenameValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSave,
  onDelete,
  onUse,
  onPlace
}: AssetCardProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const url = bufferToObjectUrl(asset.pngBytes);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [asset.pngBytes]);

  const isRenaming = renamingId === asset.id;

  return (
    <article className="surface-card p-3">
      <button
        className="focus-ring w-full bg-mist/40 p-2"
        type="button"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(
            ASSET_DRAG_TYPE,
            JSON.stringify({ id: asset.id, kind: asset.kind, width: asset.width, height: asset.height })
          );
          event.dataTransfer.effectAllowed = 'copy';
          void onUse(asset.id);
        }}
        onClick={() => void onUse(asset.id)}
      >
        {src ? <img src={src} alt={asset.label} className="mx-auto max-h-20 max-w-full object-contain" /> : null}
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
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button variant="secondary" className="px-2 text-caption" onClick={() => onRenameStart(asset)}>
                Rename
              </Button>
              <Button variant="secondary" className="px-2 text-caption" onClick={() => onDelete(asset)}>
                {STRINGS.buttons.delete}
              </Button>
              <Button
                className="px-2 text-caption"
                aria-label={STRINGS.library.placeOnPage(activePage + 1)}
                onClick={() => void onPlace(asset)}
              >
                {STRINGS.buttons.place}
              </Button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
