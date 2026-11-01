import { deleteIfExpired, deleteIfUnchanged, listSessionCandidates, type SessionCandidate } from '../db/history';
import { clearLocalData } from '../db/localData';
import { withExclusiveMaintenance, withOriginMaintenance, withSessionLock, type LockOutcome } from './sessionOwnership';

export const HISTORY_RETENTION_DAYS = 7;
export type MaintenanceResult =
  | { status: 'completed'; deleted: number; retainedActive: number; failed: number }
  | { status: 'blocked'; reason: 'locks-unavailable' | 'another-tab-active' }
  | { status: 'failed'; deleted: number; retainedActive: number; failed: number; cause: unknown };

export async function pruneExpiredSessions(cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000): Promise<MaintenanceResult> {
  let candidates: SessionCandidate[];
  try {
    candidates = await listSessionCandidates(cutoff);
  } catch (cause) {
    return { status: 'failed', deleted: 0, retainedActive: 0, failed: 1, cause };
  }
  let deleted = 0;
  let retainedActive = 0;
  let failed = 0;
  for (const candidate of candidates) {
    let outcome: LockOutcome<Awaited<ReturnType<typeof deleteIfExpired>>>;
    try {
      outcome = await withSessionLock(candidate.id, () => deleteIfExpired(candidate.id, candidate.storageRevision, cutoff));
    } catch (cause) {
      failed += 1;
      return { status: 'failed', deleted, retainedActive, failed, cause };
    }
    if (outcome.status === 'unavailable') return { status: 'blocked', reason: 'locks-unavailable' };
    if (outcome.status === 'contended') {
      retainedActive += 1;
      continue;
    }
    if (outcome.value === 'deleted') deleted += 1;
    else if (outcome.value === 'changed') retainedActive += 1;
  }
  return { status: 'completed', deleted, retainedActive, failed };
}

export function maintenanceWarning(result: MaintenanceResult): string | null {
  if (result.status === 'blocked') return 'Automatic history cleanup was skipped because this browser cannot safely coordinate tabs.';
  if (result.status === 'failed') return 'Automatic history cleanup could not finish. Your work remains available.';
  return result.retainedActive > 0 ? 'Some active or recently changed Work Sessions were retained.' : null;
}

export async function clearEligibleHistory(ownedId?: string): Promise<MaintenanceResult> {
  let deleted = 0;
  let retainedActive = 0;
  try {
    const candidates = await listSessionCandidates(Number.POSITIVE_INFINITY);
    for (const candidate of candidates) {
      if (candidate.id === ownedId) {
        if (await deleteIfUnchanged(candidate.id, candidate.storageRevision) === 'deleted') deleted += 1;
        continue;
      }
      const outcome = await withSessionLock(candidate.id, () => deleteIfUnchanged(candidate.id, candidate.storageRevision));
      if (outcome.status === 'unavailable') return { status: 'blocked', reason: 'locks-unavailable' };
      if (outcome.status === 'contended') retainedActive += 1;
      else if (outcome.value === 'deleted') deleted += 1;
      else if (outcome.value === 'changed') retainedActive += 1;
    }
    return { status: 'completed', deleted, retainedActive, failed: 0 };
  } catch (cause) {
    return { status: 'failed', deleted, retainedActive, failed: 1, cause };
  }
}

export async function clearAllLocalDataSafely(): Promise<MaintenanceResult> {
  const outcome = await withExclusiveMaintenance(async () => clearLocalData('all'));
  if (outcome.status === 'unavailable') return { status: 'blocked', reason: 'locks-unavailable' };
  if (outcome.status === 'contended') return { status: 'blocked', reason: 'another-tab-active' };
  return { status: 'completed', deleted: outcome.value.sessionsCleared ? 1 : 0, retainedActive: 0, failed: 0 };
}

export async function clearHistorySafely(ownedId?: string): Promise<MaintenanceResult> {
  const outcome = await withOriginMaintenance(() => clearEligibleHistory(ownedId));
  if (outcome.status === 'unavailable') return { status: 'blocked', reason: 'locks-unavailable' };
  if (outcome.status === 'contended') return { status: 'blocked', reason: 'another-tab-active' };
  return outcome.value;
}
