import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { deleteAsset, exportLibrary, getLastExportAt, importLibrary, listAssets, markLibraryExportOffered, resetSignaturePrefsCache } from '../../src/db/signatures';
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
    const bigBytes = paddedPng(300 * KB);
    await importLibrary(new File([JSON.stringify({
      version: 1,
      signatures: [{
        id: 'big-png', kind: 'signature', source: 'drawn', label: 'Big',
        pngBytes: bigChunks(bigBytes, 32766),
        width: 1, height: 1, createdAt: 1, lastUsedAt: 1
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

function paddedPng(target: number) {
  const base = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  const prefixLength = base.length - 12;
  const dataLength = target - prefixLength - 24;
  const data = new Uint8Array(dataLength);
  const out = new Uint8Array(target);
  out.set(base.subarray(0, prefixLength));
  new DataView(out.buffer).setUint32(prefixLength, dataLength);
  out.set([116, 69, 88, 116], prefixLength + 4);
  out.set(data, prefixLength + 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(prefixLength + 4, prefixLength + 8 + dataLength)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  new DataView(out.buffer).setUint32(prefixLength + 8 + dataLength, (crc ^ 0xffffffff) >>> 0);
  out.set(base.subarray(base.length - 12), target - 12);
  return out;
}

describe('ImportExport component', () => {
  beforeEach(async () => {
    await clearLibrary();
    resetSignaturePrefsCache();
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
