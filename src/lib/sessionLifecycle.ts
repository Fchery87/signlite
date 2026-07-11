import { pruneOldSessions, loadLatestSession } from '../db/history';
import { hydrateSignaturePrefs, isUsingMemoryStore } from '../db/signatures';
import { normalizeSession } from './normalizeSession';
import type { WorkSession } from '../db/schema';

export interface StartupResult {
  /** Normalized candidate ready for resume, or null when none exists. */
  candidate: WorkSession | null;
  /** Whether IndexedDB persistence is available. */
  storageAvailable: boolean;
}

/**
 * Owns the active-session startup lifecycle: prune expired records,
 * hydrate signature preferences, discover the latest candidate, and
 * normalize it before the UI can offer it for resume.
 *
 * A malformed or unrecoverable candidate is rejected without preventing
 * application startup.
 */
export async function startupAndDiscover(): Promise<StartupResult> {
  // 1. Prune expired records BEFORE discovery so they are never offered.
  await pruneOldSessions();

  // 2. Hydrate signature preferences (date format, library metadata).
  await hydrateSignaturePrefs();

  const storageAvailable = !isUsingMemoryStore();

  // 3. Discover the latest candidate.
  const latest = await loadLatestSession();
  if (!latest) {
    return { candidate: null, storageAvailable };
  }

  // 4. Normalize the candidate into a coherent copy before the UI can resume.
  try {
    const normalized = await normalizeSession(latest);
    return { candidate: normalized, storageAvailable };
  } catch {
    // Malformed unrecoverable candidate — reject without preventing startup.
    return { candidate: null, storageAvailable };
  }
}
