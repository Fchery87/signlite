import { beforeEach, describe, expect, it, vi } from 'vitest';
const schemaMocks = vi.hoisted(() => ({ openSignliteDb: vi.fn() }));
vi.mock('../../src/db/schema', () => schemaMocks);
import { commitSession, deleteIfUnchanged, isUsingMemoryHistory, loadLatestSession, loadSession, resetHistoryFallbackForTests } from '../../src/db/history';
import type { WorkSession } from '../../src/db/schema';

const guardSession = (id: string, value: string): WorkSession => ({
  id,
  createdAt: 1,
  updatedAt: 2,
  templatePlacements: [],
  documents: [{
    docId: `doc-${id}`,
    fileName: `${id}.pdf`,
    pdfBytes: new Uint8Array([1, 1, 1]).buffer,
    pageCount: 1,
    pageSizes: [{ w: 612, h: 792 }],
    placements: [{ id: `p-${id}`, type: 'text', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, value }],
    status: 'placed'
  }]
});

describe('guarded repository memory fallback', () => {
  beforeEach(() => {
    resetHistoryFallbackForTests();
    schemaMocks.openSignliteDb.mockReset().mockRejectedValue(new Error('unavailable'));
  });

  it('mirrors revision semantics in memory when the database cannot open', async () => {
    const created = await commitSession(guardSession('memory', 'M'), { mode: 'create' });
    expect(created).toEqual({ status: 'memory-only', storageRevision: 1 });

    const updated = await commitSession(guardSession('memory', 'M2'), { mode: 'update', storageRevision: 1 });
    expect(updated).toEqual({ status: 'memory-only', storageRevision: 2 });

    const stale = await commitSession(guardSession('memory', 'M3'), { mode: 'update', storageRevision: 1 });
    expect(stale).toEqual({ status: 'conflict', reason: 'changed' });

    const loaded = await loadSession('memory');
    expect(loaded.status).toBe('found');
    if (loaded.status === 'found') {
      expect(loaded.session.documents[0].placements[0].value).toBe('M2');
      expect(loaded.storageRevision).toBe(2);
    }
    expect(isUsingMemoryHistory()).toBe(true);
  });

  it('refuses version-mismatched databases instead of silently writing memory', async () => {
    schemaMocks.openSignliteDb.mockRejectedValue(new DOMException('old bundle', 'VersionError'));

    const created = await commitSession(guardSession('blocked', 'B'), { mode: 'create' });
    expect(created).toEqual({ status: 'refused', reason: 'version' });
    // A version mismatch must not start a memory-only writer.
    expect(isUsingMemoryHistory()).toBe(false);

    const latest = await loadLatestSession();
    expect(latest).toEqual({ status: 'refused', reason: 'version' });

    expect(await loadSession('blocked')).toEqual({ status: 'refused', reason: 'version' });
    expect(await deleteIfUnchanged('blocked', 0)).toBe('missing');
  });
});
