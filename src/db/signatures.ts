import { openSignliteDb, type Prefs, type SignatureAsset } from './schema';
import { STRINGS } from '../lib/strings';

export type SaveAssetInput = Omit<SignatureAsset, 'id' | 'createdAt' | 'lastUsedAt'>;
export type UpdateAssetInput = Partial<Pick<SignatureAsset, 'label' | 'lastUsedAt'>>;

type ExportedSignatureAsset = Omit<SignatureAsset, 'pngBytes'> & { pngBytes: string };

type ExportEnvelope = {
  version: 1;
  signatures: ExportedSignatureAsset[];
};

class MemoryStore {
  signatures = new Map<string, SignatureAsset>();
  prefs: Prefs = { dateFormat: 'MMM d, yyyy' };
}

const memoryStore = new MemoryStore();
let useMemory = false;
let lastExportAtCache: number | null = null;
let dateFormatCache: string | null = null;

function isQuotaExceededError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

async function getDb() {
  if (useMemory) return null;
  try {
    return await openSignliteDb();
  } catch {
    useMemory = true;
    return null;
  }
}

function sortByLastUsedDesc(assets: SignatureAsset[]) {
  return [...assets].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
}

function encodeBase64(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer;
}

async function readBlobText(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
      reader.readAsText(blob);
    });
  }
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Response(blob).text();
}

function parseImportPayload(payload: unknown): ExportEnvelope {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(STRINGS.errors['import-invalid']);
  }

  const version = 'version' in payload ? payload.version : undefined;
  const signatures = 'signatures' in payload ? payload.signatures : undefined;
  if (version !== 1 || !Array.isArray(signatures)) {
    throw new Error(STRINGS.errors['import-invalid']);
  }

  const normalized = signatures.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(STRINGS.errors['import-invalid']);
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      (candidate.kind !== 'signature' && candidate.kind !== 'initials') ||
      (candidate.source !== 'drawn' && candidate.source !== 'typed' && candidate.source !== 'uploaded') ||
      typeof candidate.pngBytes !== 'string' ||
      typeof candidate.width !== 'number' ||
      typeof candidate.height !== 'number' ||
      typeof candidate.label !== 'string' ||
      typeof candidate.createdAt !== 'number' ||
      typeof candidate.lastUsedAt !== 'number'
    ) {
      throw new Error(STRINGS.errors['import-invalid']);
    }

    return {
      id: candidate.id,
      kind: candidate.kind,
      source: candidate.source,
      pngBytes: candidate.pngBytes,
      width: candidate.width,
      height: candidate.height,
      strokeData: typeof candidate.strokeData === 'string' ? candidate.strokeData : undefined,
      typedText: typeof candidate.typedText === 'string' ? candidate.typedText : undefined,
      typedFont: typeof candidate.typedFont === 'string' ? candidate.typedFont : undefined,
      label: candidate.label,
      createdAt: candidate.createdAt,
      lastUsedAt: candidate.lastUsedAt
    } satisfies ExportedSignatureAsset;
  });

  return { version: 1, signatures: normalized };
}

async function getPrefsRecord() {
  const db = await getDb();
  if (!db) {
    return { ...memoryStore.prefs };
  }
  return ((await db.get('prefs', 'prefs')) ?? { dateFormat: 'MMM d, yyyy' }) as Prefs;
}

async function putPrefsRecord(prefs: Prefs) {
  const db = await getDb();
  if (!db) {
    memoryStore.prefs = prefs;
    return;
  }
  await db.put('prefs', prefs, 'prefs');
}

async function setLastExportAt(value: number) {
  lastExportAtCache = value;
  const prefs = await getPrefsRecord();
  await putPrefsRecord({ ...prefs, lastExportAt: value });
}

export function getLastExportAt() {
  return lastExportAtCache ?? memoryStore.prefs.lastExportAt ?? null;
}

export function getDateFormat() {
  return dateFormatCache ?? memoryStore.prefs.dateFormat;
}

export async function setDateFormat(value: string) {
  dateFormatCache = value;
  const prefs = await getPrefsRecord();
  await putPrefsRecord({ ...prefs, dateFormat: value });
}

export async function hydrateSignaturePrefs() {
  const prefs = await getPrefsRecord();
  lastExportAtCache = prefs.lastExportAt ?? null;
  dateFormatCache = prefs.dateFormat;
}

export async function listAssets(): Promise<SignatureAsset[]> {
  const sessionAssets = Array.from(memoryStore.signatures.values());
  const db = await getDb();
  if (!db) {
    return sortByLastUsedDesc(sessionAssets);
  }

  const storedAssets = await db.getAll('signatures');
  const merged = new Map(storedAssets.map((asset) => [asset.id, asset] as const));
  sessionAssets.forEach((asset) => merged.set(asset.id, asset));
  return sortByLastUsedDesc(Array.from(merged.values()));
}

export async function getAsset(id: string): Promise<SignatureAsset | null> {
  const sessionAsset = memoryStore.signatures.get(id);
  if (sessionAsset) {
    return sessionAsset;
  }

  const db = await getDb();
  if (!db) {
    return null;
  }
  return (await db.get('signatures', id)) ?? null;
}

export async function saveAsset(input: SaveAssetInput): Promise<SignatureAsset> {
  const now = Date.now();
  const asset: SignatureAsset = { ...input, id: crypto.randomUUID(), createdAt: now, lastUsedAt: now };
  const db = await getDb();
  if (!db) {
    memoryStore.signatures.set(asset.id, asset);
    return asset;
  }

  try {
    await db.put('signatures', asset);
    void navigator.storage?.persist?.();
    return asset;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      memoryStore.signatures.set(asset.id, asset);
      throw new Error(STRINGS.errors.quota);
    }
    throw error;
  }
}

export async function updateAsset(id: string, updates: UpdateAssetInput): Promise<SignatureAsset | null> {
  const sessionAsset = memoryStore.signatures.get(id);
  if (sessionAsset) {
    const next = { ...sessionAsset, ...updates };
    memoryStore.signatures.set(id, next);
    return next;
  }

  const db = await getDb();
  if (!db) {
    return null;
  }

  const current = await db.get('signatures', id);
  if (!current) return null;
  const next = { ...current, ...updates };
  await db.put('signatures', next);
  return next;
}

export async function touchAsset(id: string): Promise<void> {
  await updateAsset(id, { lastUsedAt: Date.now() });
}

export async function deleteAsset(id: string): Promise<void> {
  memoryStore.signatures.delete(id);
  const db = await getDb();
  if (!db) {
    return;
  }
  await db.delete('signatures', id);
}

export async function exportLibrary(): Promise<Blob> {
  const assets = await listAssets();
  const signatures = assets.map((asset) => ({
    ...asset,
    pngBytes: encodeBase64(asset.pngBytes)
  }));
  await setLastExportAt(Date.now());
  return new Blob([JSON.stringify({ version: 1, signatures } satisfies ExportEnvelope, null, 2)], {
    type: 'application/json'
  });
}

export async function importLibrary(file: File): Promise<{ added: number; skipped: number }> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readBlobText(file));
  } catch {
    throw new Error(STRINGS.errors['import-invalid']);
  }

  const parsed = parseImportPayload(payload);
  const existing = new Set((await listAssets()).map((asset) => asset.id));
  const additions = parsed.signatures
    .filter((item) => !existing.has(item.id))
    .map(
      (item) =>
        ({
          ...item,
          pngBytes: decodeBase64(item.pngBytes)
        }) satisfies SignatureAsset
    );
  const skipped = parsed.signatures.length - additions.length;
  const db = await getDb();

  if (!db) {
    additions.forEach((asset) => memoryStore.signatures.set(asset.id, asset));
    return { added: additions.length, skipped };
  }

  const tx = db.transaction('signatures', 'readwrite');
  for (const asset of additions) {
    await tx.store.put(asset);
  }
  await tx.done;
  return { added: additions.length, skipped };
}

export function isUsingMemoryStore() {
  return useMemory;
}
