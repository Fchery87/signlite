import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  pruneOldSessions: vi.fn(), loadLatestSession: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(), isUsingMemoryHistory: vi.fn(), historyStorageProblem: vi.fn()
}));
const sigMocks = vi.hoisted(() => ({ hydrateSignaturePrefs: vi.fn(), isUsingMemoryStore: vi.fn() }));
const normalizeMock = vi.hoisted(() => ({ normalizeSession: vi.fn() }));

vi.mock('../../src/db/history', () => dbMocks);
vi.mock('../../src/db/signatures', () => sigMocks);
vi.mock('../../src/lib/normalizeSession', () => normalizeMock);

import { ActiveSessionLifecycle, DurabilityCoordinator, startupAndDiscover } from '../../src/lib/sessionLifecycle';
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

function harness(options: { save?: (session: WorkSession) => Promise<'persistent' | 'memory'>; stored?: string | null; coordinator?: DurabilityCoordinator; startup?: () => Promise<{ candidate: WorkSession | null; storageAvailable: boolean; storageProblem?: 'unavailable' | 'upgrade-blocked' | null }> } = {}) {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  let stored = options.stored ?? null;
  const clear = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn(options.save ?? (async () => 'persistent' as const));
  const lifecycle = new ActiveSessionLifecycle({
    startup: options.startup ?? (async () => ({ candidate: null, storageAvailable: true })),
    save,
    clear,
    storage: {
      getItem: () => stored,
      setItem: (_key, value) => { stored = value; },
      removeItem: () => { stored = null; }
    },
    schedule: (callback) => { const id = next++; callbacks.set(id, callback); return id; },
    cancel: (id) => { callbacks.delete(id); },
    coordinator: options.coordinator
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

  it('reports upgrade-blocked storage as its own problem', async () => {
    dbMocks.historyStorageProblem.mockReturnValue('upgrade-blocked');
    const result = await startupAndDiscover();
    expect(result.storageProblem).toBe('upgrade-blocked');
    expect(result.storageAvailable).toBe(true);
  });

  it('survives a pruning failure and still discovers the candidate', async () => {
    dbMocks.pruneOldSessions.mockRejectedValue(new Error('prune failed'));
    dbMocks.loadLatestSession.mockResolvedValue(makeSession());
    normalizeMock.normalizeSession.mockResolvedValue({ ...makeSession(), id: 'normalized' });
    expect((await startupAndDiscover()).candidate?.id).toBe('normalized');
  });

  it('survives a preference hydration failure and still discovers the candidate', async () => {
    sigMocks.hydrateSignaturePrefs.mockRejectedValue(new Error('prefs failed'));
    dbMocks.loadLatestSession.mockResolvedValue(makeSession());
    normalizeMock.normalizeSession.mockResolvedValue({ ...makeSession(), id: 'normalized' });
    expect((await startupAndDiscover()).candidate?.id).toBe('normalized');
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

  it('serializes a disposed controller save before a replacement controller save', async () => {
    let resolveOld!: (value: 'persistent') => void;
    const oldSave = new Promise<'persistent'>((resolve) => { resolveOld = resolve; });
    const coordinator = new DurabilityCoordinator();
    const save = vi.fn().mockReturnValueOnce(oldSave).mockResolvedValueOnce('persistent');
    const old = harness({ save, coordinator });
    const replacement = harness({ save, coordinator });
    await old.lifecycle.startup();
    await replacement.lifecycle.startup();
    old.lifecycle.observeRevision(makeSession('same'), 1);
    await old.flush();
    expect(save).toHaveBeenCalledTimes(1);
    old.lifecycle.dispose();
    replacement.lifecycle.observeRevision({ ...makeSession('same'), updatedAt: 3 }, 2);
    await replacement.flush();
    expect(save).toHaveBeenCalledTimes(1);
    resolveOld('persistent');
    await old.flush();
    await replacement.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.map(([session]) => session.updatedAt)).toEqual([2, 3]);
  });


  it('clones the session once per debounce window, not once per revision', async () => {
    const h = harness();
    await h.lifecycle.startup();

    const original = ArrayBuffer.prototype.slice;
    let copies = 0;
    ArrayBuffer.prototype.slice = function (this: ArrayBuffer, ...args: [number?, number?]) {
      copies += 1;
      return original.apply(this, args as never);
    };
    try {
      // Stands in for a placement drag: one revision per pointer move.
      for (let i = 1; i <= 50; i += 1) h.lifecycle.observeRevision(makeSession('drag'), i);
    } finally {
      ArrayBuffer.prototype.slice = original;
    }
    expect(copies).toBe(0); // nothing copied while the debounce is still pending

    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].documents[0].pdfBytes.byteLength).toBe(8);
  });

  it('startup revives a disposed controller so a StrictMode remount keeps autosaving', async () => {
    const h = harness();
    await h.lifecycle.startup();

    // React StrictMode: mount -> cleanup -> mount.
    h.lifecycle.dispose();
    await h.lifecycle.startup();

    h.lifecycle.observeRevision(makeSession('after-remount'), 1);
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].id).toBe('after-remount');
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

  it('maps upgrade-blocked storage to the conflict status with visible copy', async () => {
    const h = harness({
      startup: async () => ({ candidate: null, storageAvailable: true, storageProblem: 'upgrade-blocked' as const })
    });
    await h.lifecycle.startup();
    expect(h.lifecycle.getState().status).toBe('conflict');
    expect(h.lifecycle.getState().warning).toContain('blocked');
  });

  it('starts in the initializing status and reports memory-only, never saved, when storage is unavailable', async () => {
    const h = harness({
      save: async () => 'memory' as const,
      startup: async () => ({ candidate: null, storageAvailable: false, storageProblem: 'unavailable' as const })
    });
    expect(h.lifecycle.getState().status).toBe('initializing');
    await h.lifecycle.startup();
    expect(h.lifecycle.getState().status).toBe('memory-only');
    h.lifecycle.observeRevision(makeSession('volatile'), 1);
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.getState().status).toBe('memory-only');
  });

  it('saves the revision observed before startup completes without another edit', async () => {
    let resolveStartup!: (value: { candidate: WorkSession | null; storageAvailable: boolean }) => void;
    const startup = vi.fn(
      () => new Promise<{ candidate: WorkSession | null; storageAvailable: boolean }>((resolve) => { resolveStartup = resolve; })
    );
    const h = harness({ startup });
    const settling = h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('before-startup'), 1);
    resolveStartup({ candidate: null, storageAvailable: true });
    await settling;
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].id).toBe('before-startup');
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('keeps the latest revision dirty until its own save transaction completes', async () => {
    let resolveFirst!: (value: 'persistent') => void;
    const first = new Promise<'persistent'>((resolve) => { resolveFirst = resolve; });
    const h = harness({ save: vi.fn().mockReturnValueOnce(first).mockResolvedValue('persistent' as const) });
    await h.lifecycle.startup();

    h.lifecycle.observeRevision(makeSession('one'), 1);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('saving');

    h.lifecycle.observeRevision(makeSession('two'), 2);
    expect(h.lifecycle.getState().status).toBe('dirty');

    resolveFirst('persistent');
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.lifecycle.getState().durableRevision).toBe(1);
    expect(h.lifecycle.getState().status).toBe('dirty');

    await h.flush();
    expect(h.lifecycle.getState().durableRevision).toBe(2);
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('flushLatest persists the undurable revision immediately', async () => {
    let resolveSave!: (value: 'persistent') => void;
    const h = harness({ save: () => new Promise<'persistent'>((resolve) => { resolveSave = resolve; }) });
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('pending'), 1);
    expect(h.pending()).toBe(1);
    expect(h.save).not.toHaveBeenCalled();
    h.lifecycle.flushLatest();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.getState().status).toBe('saving');
    resolveSave('persistent');
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('flushLatest is a no-op once the latest revision is durable', async () => {
    const h = harness();
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('done'), 1);
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    h.lifecycle.flushLatest();
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('reports the error status with visible copy when a save throws and clears it after a durable save', async () => {
    let fail = true;
    const h = harness({ save: async () => { if (fail) throw new Error('disk'); return 'persistent' as const; } });
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('doomed'), 1);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('error');
    expect(h.lifecycle.getState().warning).toContain('may not survive reload');
    fail = false;
    h.lifecycle.observeRevision(makeSession('recovered'), 2);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('saved');
    expect(h.lifecycle.getState().warning).toBeNull();
  });

  it('hands the save the same source buffer references it captured', async () => {
    const h = harness();
    await h.lifecycle.startup();
    const source = new ArrayBuffer(8);
    const session = makeSession('shared');
    session.documents[0].pdfBytes = source;
    h.lifecycle.observeRevision(session, 1);
    await h.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].documents[0].pdfBytes).toBe(source);
  });

});
