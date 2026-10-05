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
      pngBytes: new Uint8Array(pngBytes(80, 40)).buffer as ArrayBuffer,
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
    expect(new Uint8Array(restored!.pngBytes)).toEqual(pngBytes(80, 40));
    expect(restored!.typedText).toBe('NN');
  });

  it('requests persistent storage when saving a library item', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist }
    });

    await saveAsset({
      kind: 'signature',
      source: 'drawn',
      pngBytes: new Uint8Array([1, 2]).buffer,
      width: 20,
      height: 10,
      label: 'Durability check'
    });

    expect(persist).toHaveBeenCalledOnce();
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

function pngBytes(width: number, height: number, fillerBytes = 0): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  header.set([0, 0, 0, 0x0d], 8);
  header.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  header[24] = 8;
  header[25] = 6;
  const iend = new Uint8Array(12);
  iend.set([0x49, 0x45, 0x4e, 0x44], 4);
  const filler = new Uint8Array(fillerBytes).fill(0x42);
  const png = new Uint8Array(header.length + filler.length + iend.length);
  png.set(header, 0);
  png.set(filler, header.length);
  png.set(iend, header.length + filler.length);
  return png;
}

function pngOfSize(totalBytes: number): Uint8Array {
  // A complete PNG of an exact byte length: header at the front, IEND trailer
  // at the very end, filler between.
  const png = new Uint8Array(totalBytes).fill(0x42);
  png.set(pngBytes(100, 50).subarray(0, 33), 0);
  png.set([0x49, 0x45, 0x4e, 0x44], totalBytes - 8);
  return png;
}

function base64Of(bytes: Uint8Array): string {
  // Chunk on a multiple of 3 so only the final chunk carries padding; encoding
  // each chunk independently would inject interior '=' and corrupt the string.
  const CHUNK = 16383;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return out;
}

function envelopeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1', kind: 'signature', source: 'drawn', label: 'A',
    pngBytes: base64Of(pngBytes(100, 50)),
    width: 100, height: 50, createdAt: 1, lastUsedAt: 1,
    ...overrides
  };
}

function importEnvelope(signatures: unknown[], fileSize?: number) {
  const file = new File([JSON.stringify({ version: 1, signatures })], 'lib.json', { type: 'application/json' });
  if (fileSize !== undefined) Object.defineProperty(file, 'size', { value: fileSize });
  return importLibrary(file);
}

describe('import envelope validation', () => {
  beforeEach(async () => {
    await clearLibrary();
  });

  it('rejects a file above the JSON byte limit before parsing it', async () => {
    await expect(importEnvelope([envelopeAsset()], 64 * 1024 * 1024 + 1)).rejects.toThrow('too large');
    expect(await listAssets()).toEqual([]);
  });

  it('rejects more than 1,000 assets', async () => {
    const signatures = Array.from({ length: 1001 }, (_, i) => envelopeAsset({ id: `id-${i}` }));
    await expect(importEnvelope(signatures)).rejects.toThrow('too many');
    expect(await listAssets()).toEqual([]);
  });

  it('rejects an imported PNG above the 10 MiB asset limit', async () => {
    // Building a 10 MiB payload and its ~14 MiB base64 form in jsdom costs
    // seconds of real work; the default 5 s budget is not evidence of a hang.
    await expect(importEnvelope([envelopeAsset({ pngBytes: base64Of(pngOfSize(10 * 1024 * 1024 + 1)) })])).rejects.toThrow("isn't a SignLite");
    expect(await listAssets()).toEqual([]);
  }, 60_000);

  it('accepts an imported PNG of exactly the asset byte limit', async () => {
    // The ceiling is checked from the base64 length before decoding. An exact-fit
    // payload must survive that check, trailing padding included.
    await expect(importEnvelope([envelopeAsset({ pngBytes: base64Of(pngOfSize(10 * 1024 * 1024)) })])).resolves.toMatchObject({ added: 1 });
    expect(await listAssets()).toHaveLength(1);
  }, 60_000);

  it('rejects invalid and truncated base64', async () => {
    await expect(importEnvelope([envelopeAsset({ pngBytes: 'not/base64!!!' })])).rejects.toThrow("isn't a SignLite");
    const truncated = base64Of(pngBytes(100, 50)).slice(0, -2);
    await expect(importEnvelope([envelopeAsset({ pngBytes: truncated })])).rejects.toThrow("isn't a SignLite");
    expect(await listAssets()).toEqual([]);
  });

  it('rejects a PNG whose image data was truncated but whose header still parses', async () => {
    // Slicing whole base64 quanta keeps the string valid base64, so the only
    // remaining signal that the payload is broken is the missing IEND trailer.
    const truncated = base64Of(pngBytes(100, 50, 64)).slice(0, -24);
    expect(truncated.length % 4).toBe(0);
    await expect(importEnvelope([envelopeAsset({ pngBytes: truncated })])).rejects.toThrow("isn't a SignLite");
    expect(await listAssets()).toEqual([]);
  });

  it('rejects zero and negative dimensions', async () => {
    await expect(importEnvelope([envelopeAsset({ width: 0 })])).rejects.toThrow("isn't a SignLite");
    await expect(importEnvelope([envelopeAsset({ height: -5 })])).rejects.toThrow("isn't a SignLite");
    expect(await listAssets()).toEqual([]);
  });

  it('rejects dimensions beyond the processing caps', async () => {
    await expect(importEnvelope([envelopeAsset({ width: 4097, height: 50 })])).rejects.toThrow("isn't a SignLite");
    await expect(importEnvelope([envelopeAsset({ width: 4096, height: 4096 })])).rejects.toThrow("isn't a SignLite");
    expect(await listAssets()).toEqual([]);
  });

  it('rejects decoded bytes that are not PNG and metadata that disagrees with the IHDR', async () => {
    const notPng = new Uint8Array(64).fill(7);
    await expect(importEnvelope([envelopeAsset({ pngBytes: base64Of(notPng) })])).rejects.toThrow("isn't a SignLite");
    await expect(importEnvelope([envelopeAsset({ pngBytes: base64Of(pngBytes(200, 50)) })])).rejects.toThrow("isn't a SignLite");
    expect(await listAssets()).toEqual([]);
  });

  it('rejects conflicting duplicate IDs inside one file and writes nothing', async () => {
    const first = envelopeAsset();
    const conflicting = envelopeAsset({ label: 'Different', width: 120, pngBytes: base64Of(pngBytes(120, 50)) });
    await expect(importEnvelope([first, conflicting])).rejects.toThrow('same ID');
    expect(await listAssets()).toEqual([]);
  });

  it('counts identical duplicates as skipped and imports existing IDs as skipped', async () => {
    const asset = envelopeAsset();
    const result = await importEnvelope([asset, { ...asset }]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);

    const again = await importEnvelope([asset]);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(1);
    expect((await listAssets()).length).toBe(1);
  });

  it('keeps every previous record unchanged when an import fails midway', async () => {
    await importEnvelope([envelopeAsset({ id: 'kept-1' })]);
    const before = await listAssets();
    await expect(
      importEnvelope([envelopeAsset({ id: 'kept-2' }), envelopeAsset({ id: 'bad-1', width: 0 })])
    ).rejects.toThrow("isn't a SignLite");
    const after = await listAssets();
    expect(after.map((asset) => asset.id)).toEqual(before.map((asset) => asset.id));
  });
});
