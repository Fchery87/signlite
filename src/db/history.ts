import { openSignliteDb, type WorkSession } from './schema';

const memorySessions = new Map<string, WorkSession>();
let useMemory = false;

export type SaveSessionOutcome = 'persistent' | 'memory';

export function isUsingMemoryHistory() { return useMemory; }

function isQuotaExceeded(error: unknown) {
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

export async function saveSession(session: WorkSession): Promise<SaveSessionOutcome> {
  if (session.documents.length === 0) return useMemory ? 'memory' : 'persistent';
  const db = await getDb();
  if (!db) {
    memorySessions.set(session.id, session);
    return 'memory';
  }
  try {
    await db.put('sessions', session);
    memorySessions.delete(session.id);
    return 'persistent';
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
    useMemory = true;
    memorySessions.set(session.id, session);
    return 'memory';
  }
}

export async function loadLatestSession(): Promise<WorkSession | null> {
  const db = await getDb();
  if (!db) {
    return Array.from(memorySessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }
  const sessions = await db.getAllFromIndex('sessions', 'by-updated-at');
  return sessions.at(-1) ?? null;
}

export async function clearSession(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    memorySessions.delete(id);
    return;
  }
  await db.delete('sessions', id);
}

export async function pruneOldSessions(cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000) {
  const db = await getDb();
  if (!db) return;
  const tx = db.transaction('sessions', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.updatedAt < cutoff) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Test-only reset for storage fallback contracts. */
export function resetHistoryFallbackForTests() {
  useMemory = false;
  memorySessions.clear();
}
