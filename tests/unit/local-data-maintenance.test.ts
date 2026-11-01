import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllLocalDataSafely, clearHistorySafely, pruneExpiredSessions } from '../../src/lib/localDataMaintenance';
import { acquireSessionOwnership, withExclusiveMaintenance, withOriginMaintenance, withSessionLock } from '../../src/lib/sessionOwnership';
import { deleteIfExpired, listSessionCandidates } from '../../src/db/history';
import { clearLocalData } from '../../src/db/localData';

vi.mock('../../src/db/history', () => ({ listSessionCandidates: vi.fn(), deleteIfExpired: vi.fn(), deleteIfUnchanged: vi.fn() }));
vi.mock('../../src/db/localData', () => ({ clearLocalData: vi.fn() }));
vi.mock('../../src/lib/sessionOwnership', () => ({ acquireSessionOwnership: vi.fn(), withExclusiveMaintenance: vi.fn(), withOriginMaintenance: vi.fn(), withSessionLock: vi.fn() }));
const candidate = { id: 'candidate', storageRevision: 2, updatedAt: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listSessionCandidates).mockResolvedValue([candidate]);
  vi.mocked(withExclusiveMaintenance).mockImplementation(async (operation) => ({ status: 'acquired', value: await operation() }));
  vi.mocked(withOriginMaintenance).mockImplementation(async (operation) => ({ status: 'acquired', value: await operation() }));
  vi.mocked(withSessionLock).mockImplementation(async (_id, operation) => ({ status: 'acquired', value: await operation() }));
});

describe('maintenance safety boundaries', () => {
  it('never clears stores when origin authority is unavailable or contended', async () => {
    for (const status of ['unavailable', 'contended'] as const) {
      vi.mocked(withExclusiveMaintenance).mockResolvedValueOnce({ status });
      expect((await clearAllLocalDataSafely()).status).toBe('blocked');
    }
    expect(clearLocalData).not.toHaveBeenCalled();
    expect(listSessionCandidates).not.toHaveBeenCalled();
  });

  it('releases already acquired session locks when a later session is active', async () => {
    const release = vi.fn(async () => {});
    vi.mocked(listSessionCandidates).mockResolvedValue([candidate, { ...candidate, id: 'active' }]);
    vi.mocked(acquireSessionOwnership).mockResolvedValueOnce({ status: 'owned', release }).mockResolvedValueOnce({ status: 'contended' });
    expect(await clearAllLocalDataSafely()).toEqual({ status: 'blocked', reason: 'another-tab-active' });
    expect(clearLocalData).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases session locks before propagating an atomic clear failure', async () => {
    const release = vi.fn(async () => {});
    const cause = new Error('transaction aborted');
    vi.mocked(acquireSessionOwnership).mockResolvedValue({ status: 'owned', release });
    vi.mocked(clearLocalData).mockRejectedValue(cause);
    expect(await clearAllLocalDataSafely()).toMatchObject({ status: 'failed', cause });
    expect(release).toHaveBeenCalledOnce();
  });

  it('retention preserves contended records and rechecks expiry under acquired locks', async () => {
    vi.mocked(listSessionCandidates).mockResolvedValue([candidate, { ...candidate, id: 'expired' }, { ...candidate, id: 'changed' }]);
    vi.mocked(withSessionLock).mockResolvedValueOnce({ status: 'contended' });
    vi.mocked(deleteIfExpired).mockResolvedValueOnce('deleted').mockResolvedValueOnce('changed');
    expect(await pruneExpiredSessions(100)).toEqual({ status: 'completed', deleted: 1, retainedActive: 2, failed: 0 });
    expect(deleteIfExpired).toHaveBeenCalledWith('expired', 2, 100);
    expect(deleteIfExpired).not.toHaveBeenCalledWith('candidate', 2, 100);
  });

  it('history refuses when lock support is absent without deleting records', async () => {
    vi.mocked(withOriginMaintenance).mockResolvedValue({ status: 'unavailable' });
    expect(await clearHistorySafely()).toEqual({ status: 'blocked', reason: 'locks-unavailable' });
    expect(listSessionCandidates).not.toHaveBeenCalled();
  });
});
