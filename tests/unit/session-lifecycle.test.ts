import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  pruneOldSessions: vi.fn(), loadLatestSession: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), isUsingMemoryHistory: vi.fn()
}));
const sigMocks = vi.hoisted(() => ({ hydrateSignaturePrefs: vi.fn(), isUsingMemoryStore: vi.fn() }));
const normalizeMock = vi.hoisted(() => ({ normalizeSession: vi.fn() }));

vi.mock('../../src/db/history', () => dbMocks);
vi.mock('../../src/db/signatures', () => sigMocks);
vi.mock('../../src/lib/normalizeSession', () => normalizeMock);

import { ActiveSessionLifecycle, startupAndDiscover } from '../../src/lib/sessionLifecycle';
import type { WorkSession } from '../../src/db/schema';

function makeSession(id = 's1', documents = 1): WorkSession {
  return {
    id, createdAt: 1, updatedAt: 2,
    documents: Array.from({ length: documents }, (_, index) => ({
      docId: `d${index}`, fileName: 'a.pdf', pdfBytes: new ArrayBuffer(8), pageCount: 1,
      pageSizes: [{ w: 612, h: 792 }], placements: [], status: 'pending' as const
    })),
    templatePlacements: []
  };
}

function harness(options: { save?: (session: WorkSession) => Promise<'persistent' | 'memory'>; stored?: string | null } = {}) {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  let stored = options.stored ?? null;
  const clear = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn(options.save ?? (async () => 'persistent' as const));
  const lifecycle = new ActiveSessionLifecycle({
    startup: async () => ({ candidate: null, storageAvailable: true }),
    save,
    clear,
    storage: {
      getItem: () => stored,
      setItem: (_key, value) => { stored = value; },
      removeItem: () => { stored = null; }
    },
    schedule: (callback) => { const id = next++; callbacks.set(id, callback); return id; },
    cancel: (id) => { callbacks.delete(id); }
  });
  const flush = async () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  return { lifecycle, save, clear, flush, stored: () => stored, pending: () => callbacks.size };
}

describe('sessionLifecycle startupAndDiscover', () => {
  beforeEach(() => {
    dbMocks.pruneOldSessions.mockReset().mockResolvedValue(undefined);
    dbMocks.loadLatestSession.mockReset().mockResolvedValue(null);
    dbMocks.isUsingMemoryHistory.mockReset().mockReturnValue(false);
    sigMocks.hydrateSignaturePrefs.mockReset().mockResolvedValue(undefined);
    sigMocks.isUsingMemoryStore.mockReset().mockReturnValue(false);
    normalizeMock.normalizeSession.mockReset();
  });

  it('prunes expired records before discovering a candidate', async () => {
    const order: string[] = [];
    dbMocks.pruneOldSessions.mockImplementation(async () => { order.push('prune'); });
    dbMocks.loadLatestSession.mockImplementation(async () => { order.push('load'); return null; });
    await startupAndDiscover();
    expect(order).toEqual(['prune', 'load']);
  });

  it('reports history fallback after discovery opens unavailable storage', async () => {
    dbMocks.isUsingMemoryHistory.mockReturnValue(true);
    expect((await startupAndDiscover()).storageAvailable).toBe(false);
  });

  it('returns a normalized candidate and rejects malformed candidates safely', async () => {
    const session = makeSession();
    dbMocks.loadLatestSession.mockResolvedValue(session);
    normalizeMock.normalizeSession.mockResolvedValue({ ...session, id: 'normalized' });
    expect((await startupAndDiscover()).candidate?.id).toBe('normalized');
    normalizeMock.normalizeSession.mockRejectedValue(new Error('corrupt'));
    expect((await startupAndDiscover()).candidate).toBeNull();
  });
});

describe('ActiveSessionLifecycle durability', () => {
  it('debounces revisions, replaces the pending save, and saves the latest coherent snapshot', async () => {
    const h = harness();
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('one'), 1);
    h.lifecycle.observeRevision(makeSession('two'), 2);
    expect(h.pending()).toBe(1);
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].id).toBe('two');
    h.lifecycle.observeRevision(makeSession('ignored'), 2);
    expect(h.pending()).toBe(0);
  });

  it('clears an empty session only by its own identity', async () => {
    const h = harness();
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('empty', 0), 1);
    await h.flush();
    expect(h.clear).toHaveBeenCalledWith('empty');
  });

  it('retains a Start Fresh predecessor through empty and memory-only replacement saves', async () => {
    const h = harness({ save: async () => 'memory' });
    await h.lifecycle.startup();
    h.lifecycle.startFresh('predecessor', () => undefined);
    h.lifecycle.observeRevision(makeSession('replacement', 0), 1);
    expect(h.clear).not.toHaveBeenCalledWith('predecessor');
    h.lifecycle.observeRevision(makeSession('replacement'), 2);
    await h.flush();
    expect(h.clear).not.toHaveBeenCalledWith('predecessor');
    expect(h.lifecycle.getState().mode).toBe('memory');
    expect(h.lifecycle.getState().warning).toContain('will not survive reload');
  });

  it('retains predecessor after failure and clears it only after a durable replacement save', async () => {
    let fail = true;
    const h = harness({ save: async () => { if (fail) throw new Error('disk'); return 'persistent'; } });
    await h.lifecycle.startup();
    h.lifecycle.startFresh('predecessor', () => undefined);
    h.lifecycle.observeRevision(makeSession('replacement'), 1);
    await h.flush();
    expect(h.clear).not.toHaveBeenCalledWith('predecessor');
    expect(h.lifecycle.getState().warning).toContain('may not survive reload');
    fail = false;
    h.lifecycle.observeRevision(makeSession('replacement'), 2);
    await h.flush();
    expect(h.clear).toHaveBeenCalledWith('predecessor');
    expect(h.stored()).toBeNull();
  });

  it('restores predecessor retention marker after remount and warns only once', async () => {
    const first = harness({ save: async () => 'memory' });
    await first.lifecycle.startup();
    first.lifecycle.startFresh('predecessor', () => undefined);
    first.lifecycle.observeRevision(makeSession('replacement'), 1);
    await first.flush();
    const warning = first.lifecycle.getState().warning;
    const remount = harness({ save: async () => 'memory', stored: first.stored() });
    await remount.lifecycle.startup();
    remount.lifecycle.observeRevision(makeSession('replacement'), 2);
    await remount.flush();
    expect(remount.clear).not.toHaveBeenCalledWith('predecessor');
    expect(remount.lifecycle.getState().warning).toBe(warning);
  });

  it('serializes an in-flight older save before the latest revision and keeps latest durability state', async () => {
    let resolveFirst!: (value: 'memory') => void;
    let resolveSecond!: (value: 'persistent') => void;
    const first = new Promise<'memory'>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<'persistent'>((resolve) => { resolveSecond = resolve; });
    const h = harness({ save: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) });
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('replacement'), 1);
    await h.flush();
    h.lifecycle.observeRevision(makeSession('replacement'), 2);
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    resolveFirst('memory');
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(2);
    resolveSecond('persistent');
    await h.flush();
    expect(h.lifecycle.getState()).toMatchObject({ mode: 'persistent', warning: null });
  });

  it('orders an empty clear before a later nonempty save', async () => {
    let resolveClear!: () => void;
    const clearing = new Promise<void>((resolve) => { resolveClear = resolve; });
    const h = harness();
    h.clear.mockReturnValueOnce(clearing);
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('same', 0), 1);
    await h.flush();
    h.lifecycle.observeRevision(makeSession('same'), 2);
    await h.flush();
    expect(h.save).not.toHaveBeenCalled();
    resolveClear();
    await h.flush();
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'same' }));
  });

  it('dispose cancels pending work and prevents in-flight completion consequences', async () => {
    let resolveSave!: (value: 'persistent') => void;
    const saving = new Promise<'persistent'>((resolve) => { resolveSave = resolve; });
    const h = harness({ save: async () => saving });
    await h.lifecycle.startup();
    h.lifecycle.startFresh('predecessor', () => undefined);
    h.lifecycle.observeRevision(makeSession('replacement'), 1);
    await h.flush();
    h.lifecycle.dispose();
    resolveSave('persistent');
    await h.flush();
    expect(h.clear).not.toHaveBeenCalledWith('predecessor');
    expect(h.stored()).not.toBeNull();

    const pending = harness();
    await pending.lifecycle.startup();
    pending.lifecycle.observeRevision(makeSession('pending'), 1);
    pending.lifecycle.dispose();
    await pending.flush();
    expect(pending.save).not.toHaveBeenCalled();
  });

});
