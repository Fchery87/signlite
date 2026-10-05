import { openSignliteDb, type WorkSession } from './schema';

const memorySessions = new Map<string, WorkSession>();
const memoryRevisions = new Map<string, number>();
let useMemory = false;
let storageProblem: 'unavailable' | 'upgrade-blocked' | null = null;

export type SaveSessionOutcome = 'persistent' | 'memory';

export function isUsingMemoryHistory() { return useMemory || memorySessions.size > 0; }

/** Why IndexedDB is unavailable, when it is: a blocked schema upgrade is a
 *  different user-facing problem than a missing or failed open. */
export function historyStorageProblem() { return storageProblem; }

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

async function getDb() {
  try {
    return await openSignliteDb();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'VersionError') {
      // A version mismatch must not start a memory-only writer: this bundle
      // cannot read what is on disk, so every guarded operation refuses.
      storageProblem = 'upgrade-blocked';
    } else {
      useMemory = true;
      storageProblem = 'unavailable';
    }
    return null;
  }
}

export type CommitExpectation = { mode: 'create' } | { mode: 'update'; storageRevision: number };

export type CommitResult =
  | { status: 'saved'; storageRevision: number }
  | { status: 'conflict'; reason: 'exists' | 'missing' | 'changed' }
  | { status: 'memory-only'; storageRevision: number }
  | { status: 'refused'; reason: 'version' };

export type LoadOneResult =
  | { status: 'found'; session: WorkSession; storageRevision: number }
  | { status: 'missing' }
  | { status: 'refused'; reason: 'version' };

export type LatestResult = LoadOneResult;

export type DeleteResult = 'deleted' | 'changed' | 'missing';

/** Records written before storage revisions existed read as revision 0; the
 *  first guarded update legitimately expects 0 and advances them to 1. */
function recordRevision(record: WorkSession | undefined): number {
  return record?.storageRevision ?? 0;
}

function memoryGet(id: string): LoadOneResult {
  const session = memorySessions.get(id);
  if (!session) return { status: 'missing' };
  return { status: 'found', session, storageRevision: memoryRevisions.get(id) ?? 0 };
}

function memoryPut(session: WorkSession, storageRevision: number) {
  memorySessions.set(session.id, session);
  memoryRevisions.set(session.id, storageRevision);
  useMemory = true;
}

function dropMemory(id: string) {
  memorySessions.delete(id);
  memoryRevisions.delete(id);
  useMemory = memorySessions.size > 0;
}

export async function loadSession(id: string): Promise<LoadOneResult> {
  if (storageProblem === 'upgrade-blocked') return { status: 'refused', reason: 'version' };
  const db = await getDb();
  if (!db) {
    if (historyStorageProblem() === 'upgrade-blocked') return { status: 'refused', reason: 'version' };
    return memoryGet(id);
  }
  const record = await db.get('sessions', id);
  if (!record) return { status: 'missing' };
  return { status: 'found', session: record, storageRevision: recordRevision(record) };
}

export async function loadLatestSession(): Promise<LatestResult> {
  if (storageProblem === 'upgrade-blocked') return { status: 'refused', reason: 'version' };
  const db = await getDb();
  if (!db) {
    if (historyStorageProblem() === 'upgrade-blocked') return { status: 'refused', reason: 'version' };
    const newest = Array.from(memorySessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return newest ? { status: 'found', session: newest, storageRevision: memoryRevisions.get(newest.id) ?? 0 } : { status: 'missing' };
  }
  // Descending cursor over the index reads exactly one complete record, not a
  // decoded copy of every stored session.
  const tx = db.transaction('sessions', 'readonly');
  const index = tx.store.index('by-updated-at');
  const cursor = await index.openCursor(null, 'prev');
  if (cursor) {
    return { status: 'found', session: cursor.value, storageRevision: recordRevision(cursor.value) };
  }
  const memoryNewest = Array.from(memorySessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (memoryNewest) return { status: 'found', session: memoryNewest, storageRevision: memoryRevisions.get(memoryNewest.id) ?? 0 };
  return { status: 'missing' };
}

/** Optimistic-concurrency write: the expected storage revision is checked and
 *  the next revision assigned inside one readwrite transaction. */
export async function commitSession(session: WorkSession, expected: CommitExpectation): Promise<CommitResult> {
  if (storageProblem === 'upgrade-blocked') return { status: 'refused', reason: 'version' };
  const db = await getDb();
  if (!db) {
    if (historyStorageProblem() === 'upgrade-blocked') return { status: 'refused', reason: 'version' };
    const existing = memoryGet(session.id);
    const current = existing.status === 'found' ? existing.storageRevision : null;
    if (expected.mode === 'create' && current !== null) return { status: 'conflict', reason: 'exists' };
    if (expected.mode === 'update') {
      if (current === null) return { status: 'conflict', reason: 'missing' };
      if (current !== expected.storageRevision) return { status: 'conflict', reason: 'changed' };
    }
    const nextRevision = (current ?? 0) + 1;
    memoryPut(session, nextRevision);
    return { status: 'memory-only', storageRevision: nextRevision };
  }

  const tx = db.transaction('sessions', 'readwrite');
  try {
    const existing = await tx.store.get(session.id);
    const current = existing ? recordRevision(existing) : null;
    if (expected.mode === 'create' && current !== null) {
      return { status: 'conflict', reason: 'exists' };
    }
    if (expected.mode === 'update') {
      if (current === null) return { status: 'conflict', reason: 'missing' };
      if (current !== expected.storageRevision) return { status: 'conflict', reason: 'changed' };
    }
    const nextRevision = (current ?? 0) + 1;
    await tx.store.put({ ...session, storageRevision: nextRevision });
    await tx.done;
    dropMemory(session.id);
    return { status: 'saved', storageRevision: nextRevision };
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
    const nextRevision = (expected.mode === 'update' ? expected.storageRevision : 0) + 1;
    memoryPut(session, nextRevision);
    return { status: 'memory-only', storageRevision: nextRevision };
  }
}

/** Deletes a record only when its storage revision still matches. */
export async function deleteIfUnchanged(id: string, expectedRevision: number): Promise<DeleteResult> {
  if (storageProblem === 'upgrade-blocked') return 'missing';
  const db = await getDb();
  if (!db) {
    if (historyStorageProblem() === 'upgrade-blocked') return 'missing';
    const existing = memoryGet(id);
    if (existing.status !== 'found') return 'missing';
    if (existing.storageRevision !== expectedRevision) return 'changed';
    dropMemory(id);
    return 'deleted';
  }
  const tx = db.transaction('sessions', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) return 'missing';
  if (recordRevision(existing) !== expectedRevision) return 'changed';
  await tx.store.delete(id);
  await tx.done;
  dropMemory(id);
  return 'deleted';
}

/** Legacy blind writer: no production caller remains (the lifecycle commits
 *  through `commitSession`). Kept as a test fixture for storage fallback
 *  contracts; do not call from app code. */
export async function saveSession(session: WorkSession): Promise<SaveSessionOutcome> {
  if (session.documents.length === 0) return useMemory ? 'memory' : 'persistent';
  const db = await getDb();
  if (!db) {
    memorySessions.set(session.id, session);
    return 'memory';
  }
  try {
    await db.put('sessions', session);
    dropMemory(session.id);
    return 'persistent';
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
    useMemory = true;
    memorySessions.set(session.id, session);
    return 'memory';
  }
}

/** Legacy unguarded delete: retained only as a test cleanup fixture; guarded
 *  deletion goes through `deleteIfUnchanged`. */
export async function clearSession(id: string): Promise<void> {
  memorySessions.delete(id);
  const db = await getDb();
  if (!db) return;
  await db.delete('sessions', id);
  useMemory = memorySessions.size > 0;
}

export async function pruneOldSessions(
  cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000,
  withLock?: (id: string, operation: () => Promise<void>) => Promise<boolean>
) {
  const db = await getDb();
  if (!db) return;
  const tx = db.transaction('sessions', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.updatedAt < cutoff) {
      const current = cursor;
      const key = current.primaryKey;
      if (withLock) await withLock(key, async () => { await current.delete(); });
      else await current.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Drops every in-memory session mirror. IndexedDB clearing stays with the
 *  caller so a history wipe and a full wipe share one path. */
export function clearMemorySessions() {
  memorySessions.clear();
  memoryRevisions.clear();
  useMemory = false;
}

/** Test-only reset for storage fallback contracts. */
export function memoryHistorySize() {
  return memorySessions.size;
}

export function resetHistoryFallbackForTests() {
  clearMemorySessions();
  storageProblem = null;
}
