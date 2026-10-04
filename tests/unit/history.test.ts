import { clearSession, commitSession, deleteIfUnchanged, isUsingMemoryHistory, loadLatestSession, loadSession, resetHistoryFallbackForTests, saveSession } from '../../src/db/history';
import { openSignliteDb, type WorkSession } from '../../src/db/schema';

function serializeSession(session: WorkSession | null) {
  if (!session) {
    return null;
  }

  return {
    ...session,
    documents: session.documents.map((document) => ({
      ...document,
      pdfBytes: Array.from(new Uint8Array(document.pdfBytes))
    }))
  };
}

describe('history session persistence', () => {
  beforeEach(async () => {
    resetHistoryFallbackForTests();
    const db = await openSignliteDb();
    await db.clear('sessions');
  });

  afterEach(async () => {
    const latest = await loadLatestSession();
    if (latest.status === 'found') {
      await clearSession(latest.session.id);
    }
  });

  it('round-trips full batch session state including order, template placements, and per-doc statuses', async () => {
    const session: WorkSession = {
      id: 'batch-session-1',
      createdAt: 1,
      updatedAt: 2,
      templatePlacements: [
        {
          id: 'template-placement-1',
          type: 'text',
          pageIndex: 0,
          x: 0.12,
          y: 0.18,
          w: 0.22,
          h: 0.08,
          value: 'Approved',
          fontSize: 12
        }
      ],
      documents: [
        {
          docId: 'doc-3',
          fileName: 'batch-03.pdf',
          pdfBytes: new Uint8Array([3, 3, 3]).buffer,
          pageCount: 2,
          pageSizes: [
            { w: 612, h: 792 },
            { w: 612, h: 792 }
          ],
          placements: [
            {
              id: 'template-placement-1',
              type: 'text',
              pageIndex: 0,
              x: 0.12,
              y: 0.18,
              w: 0.22,
              h: 0.08,
              value: 'Approved',
              fontSize: 12
            }
          ],
          status: 'placed'
        },
        {
          docId: 'doc-1',
          fileName: 'batch-01.pdf',
          pdfBytes: new Uint8Array([1, 1, 1]).buffer,
          pageCount: 2,
          pageSizes: [
            { w: 612, h: 792 },
            { w: 612, h: 792 }
          ],
          placements: [
            {
              id: 'placement-1',
              type: 'text',
              pageIndex: 0,
              x: 0.12,
              y: 0.18,
              w: 0.22,
              h: 0.08,
              value: 'Approved',
              fontSize: 12
            }
          ],
          status: 'signed'
        },
        {
          docId: 'doc-2',
          fileName: 'batch-02.pdf',
          pdfBytes: new Uint8Array([2, 2, 2]).buffer,
          pageCount: 1,
          pageSizes: [{ w: 612, h: 792 }],
          placements: [],
          status: 'needs-review',
          batchError: 'Page 2 is missing.'
        }
      ]
    };

    expect(await saveSession(session)).toBe('persistent');

    const restored = await loadLatestSession();
    expect(restored.status).toBe('found');
    expect(serializeSession(restored.status === 'found' ? restored.session : null)).toEqual(serializeSession(session));
  });

  it('falls back to memory on quota and retries durable storage on a later save', async () => {
    const db = await openSignliteDb();
    const originalPut = db.put.bind(db);
    const put = vi.spyOn(db, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    const session: WorkSession = {
      id: 'memory-session', createdAt: 1, updatedAt: 2, templatePlacements: [],
      documents: [{ docId: 'doc', fileName: 'local.pdf', pdfBytes: new ArrayBuffer(1), pageCount: 1,
        pageSizes: [{ w: 10, h: 10 }], placements: [], status: 'pending' }]
    };
    expect(await saveSession(session)).toBe('memory');
    const latest = await loadLatestSession();
    expect(latest.status).toBe('found');
    if (latest.status === 'found') expect(latest.session.id).toBe('memory-session');
    expect(isUsingMemoryHistory()).toBe(true);
    put.mockImplementation(originalPut);
    expect(await saveSession({ ...session, updatedAt: 3 })).toBe('persistent');
    expect(isUsingMemoryHistory()).toBe(false);
    const reloaded = await loadLatestSession();
    expect(reloaded.status).toBe('found');
    if (reloaded.status === 'found') expect(reloaded.session).toEqual(expect.objectContaining({ updatedAt: 3 }));
    put.mockRestore();
  });

  it('propagates non-quota put failures', async () => {
    const db = await openSignliteDb();
    const put = vi.spyOn(db, 'put').mockRejectedValueOnce(new Error('disk failure'));
    await expect(saveSession({
      id: 'failed', createdAt: 1, updatedAt: 2, templatePlacements: [],
      documents: [{ docId: 'doc', fileName: 'local.pdf', pdfBytes: new ArrayBuffer(1), pageCount: 1,
        pageSizes: [{ w: 10, h: 10 }], placements: [], status: 'pending' }]
    })).rejects.toThrow('disk failure');
    put.mockRestore();
  });
});

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

describe('guarded session repository', () => {
  beforeEach(async () => {
    resetHistoryFallbackForTests();
    const db = await openSignliteDb();
    await db.clear('sessions');
  });

  it('creates a session only when the id is absent and returns the new storage revision', async () => {
    const created = await commitSession(guardSession('writer-a', 'A'), { mode: 'create' });
    expect(created).toEqual({ status: 'saved', storageRevision: 1 });

    const again = await commitSession(guardSession('writer-a', 'A2'), { mode: 'create' });
    expect(again).toEqual({ status: 'conflict', reason: 'exists' });

    const loaded = await loadSession('writer-a');
    expect(loaded.status).toBe('found');
    if (loaded.status === 'found') {
      expect(loaded.storageRevision).toBe(1);
      expect(loaded.session.documents[0].placements[0].value).toBe('A');
    }
  });

  it('refuses a stale second writer and keeps the first saved content intact', async () => {
    const created = await commitSession(guardSession('two-writers', 'A'), { mode: 'create' });
    expect(created.status).toBe('saved');
    const baseRevision = created.status === 'saved' ? created.storageRevision : 0;

    // Writer B wins the revision race with literal placement B.
    const writerB = await commitSession(guardSession('two-writers', 'B'), { mode: 'update', storageRevision: baseRevision });
    expect(writerB).toEqual({ status: 'saved', storageRevision: baseRevision + 1 });

    // Writer A, still holding the stale revision, must be refused.
    const staleA = await commitSession(guardSession('two-writers', 'A2'), { mode: 'update', storageRevision: baseRevision });
    expect(staleA).toEqual({ status: 'conflict', reason: 'changed' });

    const loaded = await loadSession('two-writers');
    expect(loaded.status).toBe('found');
    if (loaded.status === 'found') {
      expect(loaded.session.documents[0].placements[0].value).toBe('B');
      expect(loaded.storageRevision).toBe(baseRevision + 1);
    }
  });

  it('updates a legacy revision-0 record but rejects an update whose record was deleted', async () => {
    const db = await openSignliteDb();
    // A legacy record written before storage revisions existed.
    await db.put('sessions', guardSession('legacy', 'L'));

    const loaded = await loadSession('legacy');
    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') return;
    expect(loaded.storageRevision).toBe(0);

    const updated = await commitSession(guardSession('legacy', 'L2'), { mode: 'update', storageRevision: 0 });
    expect(updated).toEqual({ status: 'saved', storageRevision: 1 });

    await deleteIfUnchanged('legacy', 1);
    const deleted = await commitSession(guardSession('legacy', 'L3'), { mode: 'update', storageRevision: 1 });
    expect(deleted).toEqual({ status: 'conflict', reason: 'missing' });
  });

  it('deletes only when the expected revision still matches', async () => {
    const created = await commitSession(guardSession('deleter', 'D'), { mode: 'create' });
    const baseRevision = created.status === 'saved' ? created.storageRevision : 0;

    expect(await deleteIfUnchanged('deleter', baseRevision + 5)).toBe('changed');
    expect(await deleteIfUnchanged('absent', 0)).toBe('missing');
    expect(await deleteIfUnchanged('deleter', baseRevision)).toBe('deleted');
    expect(await deleteIfUnchanged('deleter', baseRevision)).toBe('missing');
  });

  it('reads only the newest complete session rather than cloning every record', async () => {
    await commitSession({ ...guardSession('older', 'O'), updatedAt: 10 }, { mode: 'create' });
    await commitSession({ ...guardSession('newest', 'N'), updatedAt: 20 }, { mode: 'create' });
    await commitSession({ ...guardSession('middle', 'M'), updatedAt: 15 }, { mode: 'create' });

    const latest = await loadLatestSession();
    expect(latest.status).toBe('found');
    if (latest.status === 'found') {
      expect(latest.session.id).toBe('newest');
      expect(latest.storageRevision).toBe(1);
    }
  });
});
