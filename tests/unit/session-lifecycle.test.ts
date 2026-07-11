import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  pruneOldSessions: vi.fn(),
  loadLatestSession: vi.fn()
}));
const sigMocks = vi.hoisted(() => ({
  hydrateSignaturePrefs: vi.fn(),
  isUsingMemoryStore: vi.fn()
}));
const normalizeMock = vi.hoisted(() => ({
  normalizeSession: vi.fn()
}));

vi.mock('../../src/db/history', () => dbMocks);
vi.mock('../../src/db/signatures', () => sigMocks);
vi.mock('../../src/lib/normalizeSession', () => normalizeMock);

import { startupAndDiscover } from '../../src/lib/sessionLifecycle';
import type { WorkSession } from '../../src/db/schema';

function makeSession(): WorkSession {
  return {
    id: 's1', createdAt: 1, updatedAt: 2,
    documents: [{
      docId: 'd1', fileName: 'a.pdf', pdfBytes: new ArrayBuffer(8),
      pageCount: 1, pageSizes: [{ w: 612, h: 792 }], placements: [], status: 'pending'
    }],
    templatePlacements: []
  };
}

describe('sessionLifecycle startupAndDiscover', () => {
  beforeEach(() => {
    dbMocks.pruneOldSessions.mockReset().mockResolvedValue(undefined);
    dbMocks.loadLatestSession.mockReset().mockResolvedValue(null);
    sigMocks.hydrateSignaturePrefs.mockReset().mockResolvedValue(undefined);
    sigMocks.isUsingMemoryStore.mockReset().mockReturnValue(false);
    normalizeMock.normalizeSession.mockReset();
  });

  it('prunes expired records before discovering a candidate', async () => {
    const order: string[] = [];
    dbMocks.pruneOldSessions.mockImplementation(async () => { order.push('prune'); });
    dbMocks.loadLatestSession.mockImplementation(async () => { order.push('load'); return null; });
    sigMocks.hydrateSignaturePrefs.mockImplementation(async () => { order.push('hydrate'); });

    await startupAndDiscover();
    expect(order.indexOf('prune')).toBeLessThan(order.indexOf('load'));
  });

  it('returns a normalized candidate when one exists', async () => {
    const session = makeSession();
    const normalized = { ...session, id: 'normalized' };
    dbMocks.loadLatestSession.mockResolvedValue(session);
    normalizeMock.normalizeSession.mockResolvedValue(normalized);

    const result = await startupAndDiscover();
    expect(result.candidate).toEqual(normalized);
    expect(normalizeMock.normalizeSession).toHaveBeenCalledWith(session);
  });

  it('returns null candidate when no sessions exist', async () => {
    dbMocks.loadLatestSession.mockResolvedValue(null);
    const result = await startupAndDiscover();
    expect(result.candidate).toBeNull();
  });

  it('rejects a malformed candidate without preventing startup', async () => {
    dbMocks.loadLatestSession.mockResolvedValue(makeSession());
    normalizeMock.normalizeSession.mockRejectedValue(new Error('corrupt'));

    const result = await startupAndDiscover();
    expect(result.candidate).toBeNull();
  });

  it('reports storage availability', async () => {
    sigMocks.isUsingMemoryStore.mockReturnValue(true);
    const result = await startupAndDiscover();
    expect(result.storageAvailable).toBe(false);
  });

  it('hydrates signature preferences during startup', async () => {
    await startupAndDiscover();
    expect(sigMocks.hydrateSignaturePrefs).toHaveBeenCalled();
  });
});
