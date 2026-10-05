import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { deleteAsset, exportLibrary, getLastExportAt, importLibrary, listAssets, markLibraryExportOffered, resetSignaturePrefsCacheForTests } from '../../src/db/signatures';
import { openSignliteDb } from '../../src/db/schema';
import { ImportExport } from '../../src/components/library/ImportExport';

const KB = 1024;

function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(blob);
  });
}

async function clearLibrary() {
  await Promise.all((await listAssets()).map((asset) => deleteAsset(asset.id)));
}

describe('library export envelope', () => {
  beforeEach(async () => {
    await clearLibrary();
  });

  // Measured at roughly 22 s on its own for a 300 KB payload in jsdom, so a
  // 30 s budget fails intermittently under suite contention rather than on a
  // real regression.
  it('round-trips a valid PNG above 250 KB without the spread encoder overflowing', { timeout: 120000 }, async () => {
    const bigBytes = new Uint8Array(300 * KB);
    bigBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bigBytes.set([0, 0, 0, 0x0d], 8);
    bigBytes.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(bigBytes.buffer).setUint32(16, 10);
    new DataView(bigBytes.buffer).setUint32(20, 10);
    bigBytes[24] = 8;
    bigBytes[25] = 6;
    for (let i = 33; i < bigBytes.length - 12; i += 1) bigBytes[i] = i & 0xff;
    // Import validation requires a complete PNG, which ends with IEND.
    bigBytes.set([0x49, 0x45, 0x4e, 0x44], bigBytes.length - 8);
    await importLibrary(new File([JSON.stringify({
      version: 1,
      signatures: [{
        id: 'big-png', kind: 'signature', source: 'drawn', label: 'Big',
        pngBytes: bigChunks(bigBytes, 32766),
        width: 10, height: 10, createdAt: 1, lastUsedAt: 1
      }]
    })], 'seed.json', { type: 'application/json' }));

    const blob = await exportLibrary();
    const text = await readBlobText(blob);
    expect(text.length).toBeGreaterThan(300 * KB);

    await clearLibrary();
    await importLibrary(new File([text], 'restore.json', { type: 'application/json' }));
    const restored = (await listAssets()).find((asset) => asset.id === 'big-png');
    expect(restored).toBeDefined();
    expect(new Uint8Array(restored!.pngBytes)).toEqual(bigBytes);
  });

  it('advances the export watermark only when the export offer is accepted', async () => {
    expect(getLastExportAt()).toBeNull();
    const blob = await exportLibrary();
    expect(getLastExportAt()).toBeNull();
    const before = Date.now();
    await markLibraryExportOffered();
    expect(getLastExportAt()).toBeGreaterThanOrEqual(before - 5);
    expect(blob.size).toBeGreaterThan(2);
  });
});

function bigChunks(bytes: Uint8Array, chunk: number) {
  let out = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + chunk)));
  }
  return out;
}

describe('ImportExport component', () => {
  beforeEach(async () => {
    await clearLibrary();
    resetSignaturePrefsCacheForTests();
    const db = await openSignliteDb();
    await db.clear('prefs');
  });

  it('labels the backup as an export offer and updates after the click', async () => {
    let clickCount = 0;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { clickCount += 1; });
    const { getByText } = render(<ImportExport onImported={() => undefined} onToast={() => undefined} />);

    expect(getByText('No backup yet.')).toBeTruthy();
    fireEvent.click(getByText('Export'));
    await waitFor(() => expect(clickCount).toBe(1));
    await waitFor(() => expect(getLastExportAt()).not.toBeNull());
    await waitFor(() => {
      expect(getByText(/Export offered/).textContent).toMatch(/Export offered/);
    });
    vi.restoreAllMocks();
  });
});
