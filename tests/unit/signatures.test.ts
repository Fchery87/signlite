import { deleteAsset, exportLibrary, getAsset, importLibrary, listAssets, saveAsset, updateAsset } from '../../src/db/signatures';
import * as schema from '../../src/db/schema';

async function clearLibrary() {
  const assets = await listAssets();
  await Promise.all(assets.map((asset) => deleteAsset(asset.id)));
}

async function readBlobText(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read blob.'));
    reader.readAsText(blob);
  });
}

describe('signature store', () => {
  beforeEach(async () => {
    await clearLibrary();
  });

  it('saves, lists, renames, and deletes assets', async () => {
    const asset = await saveAsset({
      kind: 'signature',
      source: 'drawn',
      pngBytes: new Uint8Array([1, 2, 3]).buffer,
      width: 100,
      height: 50,
      label: 'Signature'
    });

    await updateAsset(asset.id, { label: 'Updated signature', lastUsedAt: asset.lastUsedAt + 1000 });

    const listed = await listAssets();
    expect(listed.find((item) => item.id === asset.id)).toMatchObject({ label: 'Updated signature' });

    await deleteAsset(asset.id);
    const remaining = await listAssets();
    expect(remaining.some((item) => item.id === asset.id)).toBe(false);
  });

  it('round-trips export and import with identical bytes', async () => {
    await saveAsset({
      kind: 'initials',
      source: 'typed',
      pngBytes: new Uint8Array([9, 8, 7, 6]).buffer,
      width: 80,
      height: 40,
      typedText: 'NN',
      typedFont: 'cursive',
      label: 'NN'
    });

    const exportBlob = await exportLibrary();
    const exportedText = await readBlobText(exportBlob);

    await clearLibrary();
    await importLibrary(new File([exportedText], 'library.json', { type: 'application/json' }));

    const [restored] = await listAssets();
    expect(restored).toBeDefined();
    expect(Array.from(new Uint8Array(restored.pngBytes))).toEqual([9, 8, 7, 6]);
    expect(restored.typedText).toBe('NN');
  });

  it('keeps quota-failed assets available for the current session', async () => {
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const openDbSpy = vi.spyOn(schema, 'openSignliteDb').mockResolvedValue({
      put: vi.fn().mockRejectedValue(quotaError),
      getAll: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined)
    } as unknown as Awaited<ReturnType<typeof schema.openSignliteDb>>);

    await expect(
      saveAsset({
        kind: 'signature',
        source: 'uploaded',
        pngBytes: new Uint8Array([4, 5, 6]).buffer,
        width: 40,
        height: 20,
        label: 'Quota fallback'
      })
    ).rejects.toThrow("Couldn't save — browser storage is full.");

    const listed = await listAssets();
    expect(listed.map((asset) => asset.label)).toContain('Quota fallback');
    const stored = await getAsset(listed[0]!.id);
    expect(stored?.label).toBe('Quota fallback');

    openDbSpy.mockRestore();
  });

  it('rejects malformed imports without writing anything', async () => {
    await expect(
      importLibrary(new File(['{"version":1,"signatures":[{"id":1}]}'], 'bad.json', { type: 'application/json' }))
    ).rejects.toThrow("This isn't a SignLite library file.");

    expect(await listAssets()).toEqual([]);
  });
});
