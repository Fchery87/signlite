import { clearLocalData } from '../../src/db/localData';
import { commitSession, loadSession, memoryHistorySize, resetHistoryFallbackForTests } from '../../src/db/history';
import { listAssets, resetMemorySignatureStoreForTests, resetSignaturePrefsCacheForTests, saveAsset } from '../../src/db/signatures';
import { openSignliteDb } from '../../src/db/schema';
import type { WorkSession } from '../../src/db/schema';

function session(id: string): WorkSession {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    documents: [],
    templatePlacements: [],
    signatureSnapshots: {}
  };
}

describe('clearLocalData', () => {
  beforeEach(async () => {
    resetHistoryFallbackForTests();
    resetMemorySignatureStoreForTests();
    resetSignaturePrefsCacheForTests();
    const db = await openSignliteDb();
    await db.clear('sessions');
    await db.clear('signatures');
    await db.clear('prefs');
  });

  it('keeps signatures when history is cleared and removes them when all data is cleared', async () => {
    const saved = await commitSession(session('kept'), { mode: 'create' });
    expect(saved.status).toBe('saved');
    await saveAsset({
      kind: 'signature',
      source: 'uploaded',
      pngBytes: new Uint8Array([137, 80, 78, 71]).buffer,
      width: 2,
      height: 1,
      label: 'Kept'
    });

    const history = await clearLocalData('history');
    expect(history).toEqual({
      kind: 'history',
      sessionsCleared: true,
      signaturesCleared: false,
      preferencesCleared: false
    });
    expect((await loadSession('kept')).status).toBe('missing');
    expect(memoryHistorySize()).toBe(0);
    expect(await listAssets()).toHaveLength(1);

    const all = await clearLocalData('all');
    expect(all.signaturesCleared).toBe(true);
    expect(await listAssets()).toHaveLength(0);

    // A second wipe of already-empty stores converges to the same empty result.
    const again = await clearLocalData('all');
    expect(again).toEqual(all);
    expect(await listAssets()).toHaveLength(0);
  });
});
