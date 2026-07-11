import { clearSession, loadLatestSession, resetHistoryFallbackForTests, saveSession } from '../../src/db/history';
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
    if (latest) {
      await clearSession(latest.id);
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

    const restoredSession = await loadLatestSession();
    expect(serializeSession(restoredSession)).toEqual(serializeSession(session));
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
    expect((await loadLatestSession())?.id).toBe('memory-session');
    put.mockImplementation(originalPut);
    expect(await saveSession({ ...session, updatedAt: 3 })).toBe('persistent');
    expect(await loadLatestSession()).toEqual(expect.objectContaining({ updatedAt: 3 }));
    put.mockRestore();
  });

  it('propagates non-quota put failures', async () => {
    const db = await openSignliteDb();
    const originalPut = db.put.bind(db);
    const put = vi.spyOn(db, 'put').mockRejectedValueOnce(new Error('disk failure'));
    await expect(saveSession({
      id: 'failed', createdAt: 1, updatedAt: 2, templatePlacements: [],
      documents: [{ docId: 'doc', fileName: 'local.pdf', pdfBytes: new ArrayBuffer(1), pageCount: 1,
        pageSizes: [{ w: 10, h: 10 }], placements: [], status: 'pending' }]
    })).rejects.toThrow('disk failure');
    put.mockRestore();
  });
});
