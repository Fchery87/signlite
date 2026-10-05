import { openSignliteDb, type Prefs, type SignatureAsset } from './schema';
import { STRINGS } from '../lib/strings';
import {
  dimensionsExceedProcessingCaps,
  IMPORT_MAX_ASSETS,
  IMPORT_MAX_DECODED_BYTES,
  IMPORT_MAX_JSON_BYTES,
  IMPORT_MAX_PNG_BYTES
} from '../lib/imagePolicy';

export type SaveAssetInput = Omit<SignatureAsset, 'id' | 'createdAt' | 'lastUsedAt'>;
export type UpdateAssetInput = Partial<Pick<SignatureAsset, 'label' | 'lastUsedAt'>>;

type ExportEnvelope = {
  version: 1;
  signatures: Array<Omit<SignatureAsset, 'pngBytes'> & { pngBytes: string }>;
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
  // A single spread over the whole buffer overflows the call stack above a few
  // hundred kilobytes; bounded chunks keep every valid PNG encodable.
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x4000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isValidBase64(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}

/** Decoded size implied by a base64 string, read from its length and trailing
 *  padding without decoding it. Lets the byte ceilings reject an oversized
 *  asset before the regex scan and `atob` ever touch a multi-megabyte payload,
 *  and stays exact so a payload of exactly the limit is still accepted. */
function impliedDecodedBytes(value: string) {
  const padding = (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  return Math.floor((value.length * 3) / 4) - padding;
}

function pngHeaderDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Every complete PNG ends with the 12-byte IEND chunk. A payload whose
 *  header parses but whose image data was cut short would import cleanly and
 *  then fail to render, so the trailer is checked as well. */
function pngIsComplete(bytes: Uint8Array) {
  if (bytes.length < 45) return false;
  const end = bytes.length - 8;
  return bytes[end] === 0x49 && bytes[end + 1] === 0x45 && bytes[end + 2] === 0x4e && bytes[end + 3] === 0x44;
}

type ValidatedImport = { assets: SignatureAsset[]; identicalDuplicates: number };

/** Validates and decodes the whole envelope before anything is written: a
 *  failed import must leave every previous record unchanged. */
function validateImportEnvelope(payload: unknown): ValidatedImport {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(STRINGS.errors['import-invalid']);
  }

  const version = 'version' in payload ? payload.version : undefined;
  const signatures = 'signatures' in payload ? payload.signatures : undefined;
  if (version !== 1 || !Array.isArray(signatures)) {
    throw new Error(STRINGS.errors['import-invalid']);
  }
  if (signatures.length > IMPORT_MAX_ASSETS) {
    throw new Error(STRINGS.errors['import-too-many']);
  }

  const byId = new Map<string, SignatureAsset>();
  let identicalDuplicates = 0;
  let decodedTotal = 0;
  const invalid = () => new Error(STRINGS.errors['import-invalid']);

  for (const item of signatures) {
    if (typeof item !== 'object' || item === null) throw invalid();
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' || candidate.id.length === 0 ||
      (candidate.kind !== 'signature' && candidate.kind !== 'initials') ||
      (candidate.source !== 'drawn' && candidate.source !== 'typed' && candidate.source !== 'uploaded') ||
      typeof candidate.pngBytes !== 'string' ||
      typeof candidate.width !== 'number' || typeof candidate.height !== 'number' ||
      typeof candidate.label !== 'string' ||
      typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt) ||
      typeof candidate.lastUsedAt !== 'number' || !Number.isFinite(candidate.lastUsedAt) ||
      !Number.isInteger(candidate.width) || !Number.isInteger(candidate.height) ||
      candidate.width <= 0 || candidate.height <= 0 ||
      dimensionsExceedProcessingCaps({ width: candidate.width, height: candidate.height })
    ) {
      throw invalid();
    }

    // Byte ceilings first, from the encoded length alone: a single oversized
    // payload must not cost a regex scan and a decode before it is refused.
    const impliedBytes = impliedDecodedBytes(candidate.pngBytes);
    if (impliedBytes > IMPORT_MAX_PNG_BYTES) throw invalid();
    decodedTotal += impliedBytes;
    if (decodedTotal > IMPORT_MAX_DECODED_BYTES) {
      throw new Error(STRINGS.errors['import-too-large']);
    }

    if (!isValidBase64(candidate.pngBytes)) throw invalid();

    const png = atob(candidate.pngBytes);
    const bytes = new Uint8Array(png.length);
    for (let i = 0; i < png.length; i += 1) bytes[i] = png.charCodeAt(i);
    if (bytes.byteLength === 0) throw invalid();
    const header = pngHeaderDimensions(bytes);
    if (!header || !pngIsComplete(bytes) || header.width !== candidate.width || header.height !== candidate.height) throw invalid();

    const asset: SignatureAsset = {
      id: candidate.id,
      kind: candidate.kind,
      source: candidate.source,
      pngBytes: bytes.buffer,
      width: candidate.width,
      height: candidate.height,
      strokeData: typeof candidate.strokeData === 'string' ? candidate.strokeData : undefined,
      typedText: typeof candidate.typedText === 'string' ? candidate.typedText : undefined,
      typedFont: typeof candidate.typedFont === 'string' ? candidate.typedFont : undefined,
      label: candidate.label,
      createdAt: candidate.createdAt,
      lastUsedAt: candidate.lastUsedAt
    };

    const previous = byId.get(asset.id);
    if (previous) {
      if (previous.label !== asset.label || previous.kind !== asset.kind || previous.width !== asset.width ||
        previous.height !== asset.height || previous.pngBytes.byteLength !== asset.pngBytes.byteLength) {
        throw new Error(STRINGS.errors['import-conflict']);
      }
      identicalDuplicates += 1;
      continue;
    }
    byId.set(asset.id, asset);
  }

  return { assets: Array.from(byId.values()), identicalDuplicates };
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
    await bumpAssetsAddedSinceExport();
    return asset;
  }

  try {
    await db.put('signatures', asset);
    void navigator.storage?.persist?.();
    await bumpAssetsAddedSinceExport();
    return asset;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      memoryStore.signatures.set(asset.id, asset);
      throw new Error(STRINGS.errors.quota);
    }
    throw error;
  }
}

async function bumpAssetsAddedSinceExport(count = 1) {
  const prefs = await getPrefsRecord();
  await putPrefsRecord({ ...prefs, assetsAddedSinceExport: (prefs.assetsAddedSinceExport ?? 0) + count });
}

export type BackupReminder = { due: boolean; reason: 'days' | 'count' | null };

const REMINDER_DAYS = 30;
const REMINDER_NEW_ASSETS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The backup reminder fires 30 days after the export-offer watermark or once
 *  10 assets were added since it, whichever comes first. Legacy prefs without
 *  the fields start clean. */
export async function getBackupReminderState(now = Date.now()): Promise<BackupReminder> {
  const prefs = await getPrefsRecord();
  const added = prefs.assetsAddedSinceExport ?? 0;
  if (added >= REMINDER_NEW_ASSETS) return { due: true, reason: 'count' };
  const lastExportAt = prefs.lastExportAt ?? null;
  if (lastExportAt !== null && now - lastExportAt >= REMINDER_DAYS * DAY_MS) return { due: true, reason: 'days' };
  return { due: false, reason: null };
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
  return new Blob([JSON.stringify({ version: 1, signatures } satisfies ExportEnvelope, null, 2)], {
    type: 'application/json'
  });
}

/** Records that an export file was offered for download. Called by the UI only
 *  after the browser accepts the offer, never during envelope creation: an
 *  offer is not proof the user retained the file. */
export async function markLibraryExportOffered(now = Date.now()) {
  const prefs = await getPrefsRecord();
  await putPrefsRecord({ ...prefs, lastExportAt: now, assetsAddedSinceExport: 0 });
  lastExportAtCache = now;
}

/** Test-only reset for the cached backup watermark. */
export function resetSignaturePrefsCacheForTests() {
  lastExportAtCache = null;
}

export async function importLibrary(file: File): Promise<{ added: number; skipped: number }> {
  // Bound the work before reading: an oversized file is rejected on its size
  // alone, without parsing or decoding a byte of it.
  if (file.size > IMPORT_MAX_JSON_BYTES) {
    throw new Error(STRINGS.errors['import-too-large']);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBlobText(file));
  } catch {
    throw new Error(STRINGS.errors['import-invalid']);
  }

  const { assets, identicalDuplicates } = validateImportEnvelope(payload);
  const existing = new Set((await listAssets()).map((asset) => asset.id));
  const additions = assets.filter((asset) => !existing.has(asset.id));
  const skipped = identicalDuplicates + (assets.length - additions.length);
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
  // One increment for the whole import, not one per asset: an N-asset import
  // would otherwise run 2N transactions and lose counts under concurrency.
  if (additions.length > 0) await bumpAssetsAddedSinceExport(additions.length);
  return { added: additions.length, skipped };
}

export function isUsingMemoryStore() {
  return useMemory;
}
