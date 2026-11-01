import { openSignliteDb } from './schema';
import { resetMemorySignatureStore, resetSignaturePrefsCache } from './signatures';
import { clearMemorySessions } from './history';

export const HISTORY_RETENTION_DAYS = 7;

export type LocalDataClearKind = 'history' | 'all';

export type LocalDataClearResult = {
  kind: LocalDataClearKind;
  sessionsCleared: boolean;
  signaturesCleared: boolean;
  preferencesCleared: boolean;
};

/** Clears the stores the kind names, in IndexedDB and in the in-memory
 *  mirrors. `history` removes Work Sessions only. `all` also removes the
 *  signature library and preferences. Callers own the guards. Running twice
 *  converges to the same empty stores. */
export async function clearLocalData(kind: LocalDataClearKind): Promise<LocalDataClearResult> {
  const result: LocalDataClearResult = {
    kind,
    sessionsCleared: false,
    signaturesCleared: false,
    preferencesCleared: false
  };
  const db = await openSignliteDb();
  if (db) {
    const stores = kind === 'all' ? ['sessions', 'signatures', 'prefs'] as const : ['sessions'] as const;
    const tx = db.transaction(stores, 'readwrite');
    await tx.objectStore('sessions').clear();
    result.sessionsCleared = true;
    if (kind === 'all') {
      await tx.objectStore('signatures').clear();
      await tx.objectStore('prefs').clear();
      result.signaturesCleared = true;
      result.preferencesCleared = true;
    }
    await tx.done;
  }

  clearMemorySessions();
  if (kind === 'all') {
    resetMemorySignatureStore();
    resetSignaturePrefsCache();
  }
  return result;
}
