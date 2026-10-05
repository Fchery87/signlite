import { beforeEach, describe, expect, it } from 'vitest';
import { deleteAsset, getBackupReminderState, listAssets, markLibraryExportOffered, saveAsset } from '../../src/db/signatures';
import { openSignliteDb } from '../../src/db/schema';

const DAY = 24 * 60 * 60 * 1000;

async function seedAsset() {
  return await saveAsset({
    kind: 'signature',
    source: 'drawn',
    pngBytes: new Uint8Array([1]).buffer,
    width: 10,
    height: 10,
    label: 'Reminder fixture'
  });
}

async function seedPngImport(id: string) {
  // saveAsset stamps new ids; use import to place an asset with a stable id.
  const { importLibrary } = await import('../../src/db/signatures');
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 10);
  new DataView(bytes.buffer).setUint32(20, 10);
  // Import validation requires a complete PNG, which ends with IEND.
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  const file = new File([JSON.stringify({
    version: 1,
    signatures: [{ id, kind: 'signature', source: 'drawn', label: 'S', pngBytes: btoa(String.fromCharCode(...bytes)), width: 10, height: 10, createdAt: 1, lastUsedAt: 1 }]
  })], 'seed.json', { type: 'application/json' });
  await importLibrary(file);
}

describe('backup reminder', () => {
  beforeEach(async () => {
    await Promise.all((await listAssets()).map((asset) => deleteAsset(asset.id)));
    const db = await openSignliteDb();
    await db.clear('prefs');
  });

  it('stays quiet on legacy prefs with no watermark and no additions', async () => {
    expect(await getBackupReminderState()).toEqual({ due: false, reason: null });
  });

  it('fires the count reason at 10 newly added assets', async () => {
    for (let i = 0; i < 10; i += 1) await seedAsset();
    expect(await getBackupReminderState()).toEqual({ due: true, reason: 'count' });
  });

  it('fires the days reason 30 days after the watermark', async () => {
    await markLibraryExportOffered(Date.now() - 31 * DAY);
    await seedAsset();
    expect(await getBackupReminderState()).toEqual({ due: true, reason: 'days' });
  });

  it('stays quiet within 30 days and under 10 additions, and resets on a new offer', async () => {
    await markLibraryExportOffered(Date.now() - 5 * DAY);
    for (let i = 0; i < 9; i += 1) await seedAsset();
    expect(await getBackupReminderState()).toEqual({ due: false, reason: null });

    await markLibraryExportOffered();
    expect(await getBackupReminderState()).toEqual({ due: false, reason: null });
    expect((await openSignliteDb().then((db) => db.get('prefs', 'prefs')))?.assetsAddedSinceExport).toBe(0);
  });

  it('tracks additions from imports too', async () => {
    for (let i = 0; i < 10; i += 1) await seedPngImport(`imported-reminder-${i}`);
    expect(await getBackupReminderState()).toEqual({ due: true, reason: 'count' });
  });
});
