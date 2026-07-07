import { useEffect, useMemo, useRef, useState } from 'react';
import { exportLibrary, getLastExportAt, hydrateSignaturePrefs, importLibrary } from '../../db/signatures';
import { STRINGS } from '../../lib/strings';
import { Button } from '../ui';

type ImportExportProps = {
  onImported: () => void;
  onToast: (message: string) => void;
};

export function ImportExport({ onImported, onToast }: ImportExportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastExportAt, setLastExportAt] = useState<number | null>(() => getLastExportAt());

  useEffect(() => {
    void hydrateSignaturePrefs().then(() => setLastExportAt(getLastExportAt()));
  }, []);

  const lastExportLabel = useMemo(() => {
    if (!lastExportAt) return STRINGS.imports.noBackupYet;
    return STRINGS.imports.lastBackedUp(new Date(lastExportAt).toLocaleString());
  }, [lastExportAt]);

  const handleExport = async () => {
    try {
      const blob = await exportLibrary();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'signlite-library.json';
      anchor.click();
      URL.revokeObjectURL(url);
      const next = getLastExportAt();
      setLastExportAt(next);
      onToast(STRINGS.library.exportSuccess);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not export your library.');
    }
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    try {
      const result = await importLibrary(file);
      onImported();
      onToast(STRINGS.library.importSummary(result.added, result.skipped));
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not import this library file.');
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  return (
    <div className="surface-card bg-mist/40 p-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => void handleExport()}>
          {STRINGS.buttons.export}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => inputRef.current?.click()}>
          {STRINGS.buttons.import}
        </Button>
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="application/json"
        onChange={(event) => void handleImport(event.target.files?.[0] ?? null)}
      />
      <p className="mt-2 text-caption text-quiet">{lastExportLabel}</p>
    </div>
  );
}
