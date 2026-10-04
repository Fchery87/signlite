import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  pruneOldSessions: vi.fn(), loadLatestSession: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn(),
  commitSession: vi.fn(), deleteIfUnchanged: vi.fn(), isUsingMemoryHistory: vi.fn(), historyStorageProblem: vi.fn()
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

type HarnessOptions = {
  commit?: (session: WorkSession, expected: { mode: 'create' } | { mode: 'update'; storageRevision: number }) => Promise<unknown>;
  stored?: string | null;
  coordinator?: DurabilityCoordinator;
  startup?: () => Promise<{ candidate: WorkSession | null; storageAvailable: boolean; storageProblem?: 'unavailable' | 'upgrade-blocked' | null; baseRevision?: number }>;
  acquireOwnership?: (id: string) => Promise<{ status: string }>;
};

function harness(options: HarnessOptions = {}) {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  let stored = options.stored ?? null;
  const revisions = new Map<string, number>();
  const commit = vi.fn(options.commit ?? (async (session: WorkSession, expected: { mode: string; storageRevision?: number }) => {
    const current = revisions.get(session.id) ?? 0;
    if (expected.mode === 'update' && current !== expected.storageRevision) {
      return { status: 'conflict', reason: 'changed' };
    }
    if (expected.mode === 'create' && current > 0) {
      return { status: 'conflict', reason: 'exists' };
    }
    const nextRevision = current + 1;
    revisions.set(session.id, nextRevision);
    return { status: 'saved', storageRevision: nextRevision };
  }));
  const deleteRecord = vi.fn(async (id: string) => {
    if (revisions.has(id)) {
      revisions.delete(id);
      return { status: 'deleted' };
    }
    return { status: 'missing' };
  });
  const acquireOwnership = vi.fn(options.acquireOwnership ?? (async () => ({ status: 'owned' })));
  const lifecycle = new ActiveSessionLifecycle({
    startup: options.startup ?? (async () => ({ candidate: null, storageAvailable: true })),
    commit: commit as never,
    deleteRecord: deleteRecord as never,
    acquireOwnership: acquireOwnership as never,
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
  return { lifecycle, commit, deleteRecord, acquireOwnership, flush, stored: () => stored, pending: () => callbacks.size, revisions };
}

describe('sessionLifecycle startupAndDiscover', () => {
  beforeEach(() => {
    dbMocks.pruneOldSessions.mockReset().mockResolvedValue(undefined);
    dbMocks.loadLatestSession.mockReset().mockResolvedValue({ status: 'missing' });
    dbMocks.isUsingMemoryHistory.mockReset().mockReturnValue(false);
    sigMocks.hydrateSignaturePrefs.mockReset().mockResolvedValue(undefined);
    sigMocks.isUsingMemoryStore.mockReset().mockReturnValue(false);
    normalizeMock.normalizeSession.mockReset();
  });

  it('prunes expired records before discovering a candidate', async () => {
    const order: string[] = [];
    dbMocks.pruneOldSessions.mockImplementation(async () => { order.push('prune'); });
    dbMocks.loadLatestSession.mockImplementation(async () => { order.push('load'); return { status: 'missing' }; });
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
    dbMocks.loadLatestSession.mockResolvedValue({ status: 'found', session: makeSession(), storageRevision: 3 });
    normalizeMock.normalizeSession.mockResolvedValue({ ...makeSession(), id: 'normalized' });
    expect((await startupAndDiscover()).candidate?.id).toBe('normalized');
  });

  it('survives a preference hydration failure and still discovers the candidate', async () => {
    sigMocks.hydrateSignaturePrefs.mockRejectedValue(new Error('prefs failed'));
    dbMocks.loadLatestSession.mockResolvedValue({ status: 'found', session: makeSession(), storageRevision: 3 });
    normalizeMock.normalizeSession.mockResolvedValue({ ...makeSession(), id: 'normalized' });
    expect((await startupAndDiscover()).candidate?.id).toBe('normalized');
  });

  it('returns a normalized candidate and rejects malformed candidates safely', async () => {
    const session = makeSession();
    dbMocks.loadLatestSession.mockResolvedValue({ status: 'found', session, storageRevision: 3 });
    normalizeMock.normalizeSession.mockResolvedValue({ ...session, id: 'normalized' });
    expect((await startupAndDiscover()).candidate?.id).toBe('normalized');
    normalizeMock.normalizeSession.mockRejectedValue(new Error('corrupt'));
    expect((await startupAndDiscover()).candidate).toBeNull();
  });

  it("reports the discovered candidate's base storage revision", async () => {
    dbMocks.loadLatestSession.mockResolvedValue({ status: 'found', session: makeSession(), storageRevision: 3 });
    normalizeMock.normalizeSession.mockResolvedValue(makeSession('normalized'));
    const result = await startupAndDiscover();
    expect(result.baseRevision).toBe(3);
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
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0][0].id).toBe('two');
    h.lifecycle.observeRevision(makeSession('ignored'), 2);
    expect(h.pending()).toBe(0);
  });

  it('clears an empty session only by its own identity', async () => {
    const h = harness();
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('empty', 0), 1);
    await h.flush();
    expect(h.deleteRecord).toHaveBeenCalledWith('empty', expect.anything());
  });

  it('does not retain a Start Fresh predecessor and never deletes it eagerly', async () => {
    const h = harness();
    await h.lifecycle.startup();
    h.lifecycle.startFresh('predecessor', () => undefined);
    h.lifecycle.observeRevision(makeSession('replacement', 0), 1);
    await h.flush();
    expect(h.deleteRecord).not.toHaveBeenCalledWith('predecessor', expect.anything());
    h.lifecycle.observeRevision(makeSession('replacement'), 2);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.stored()).toBeNull();
  });

  it('Start Fresh leaves no retention marker behind for a remount', async () => {
    const first = harness();
    await first.lifecycle.startup();
    first.lifecycle.startFresh('predecessor', () => undefined);
    first.lifecycle.observeRevision(makeSession('replacement'), 1);
    await first.flush();
    expect(first.stored()).toBeNull();
    const remount = harness({ stored: first.stored() });
    await remount.lifecycle.startup();
    remount.lifecycle.observeRevision(makeSession('replacement'), 2);
    await remount.flush();
    expect(remount.deleteRecord).not.toHaveBeenCalledWith('predecessor', expect.anything());
  });

  it('serializes an in-flight older save before the latest revision and keeps latest durability state', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    let calls = 0;
    const h = harness({ commit: vi.fn(async () => { calls += 1; return calls === 1 ? first : second; }) });
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('replacement'), 1);
    await h.flush();
    h.lifecycle.observeRevision(makeSession('replacement'), 2);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    resolveFirst({ status: 'memory-only', storageRevision: 1 });
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(2);
    resolveSecond({ status: 'saved', storageRevision: 2 });
    await h.flush();
    expect(h.lifecycle.getState()).toMatchObject({ mode: 'persistent', warning: null });
  });

  it('orders an empty clear before a later nonempty save', async () => {
    let resolveDelete!: () => void;
    const deleting = new Promise<void>((resolve) => { resolveDelete = resolve; });
    const h = harness();
    h.deleteRecord.mockImplementationOnce(() => deleting as never);
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('same', 0), 1);
    await h.flush();
    h.lifecycle.observeRevision(makeSession('same'), 2);
    await h.flush();
    expect(h.commit).not.toHaveBeenCalled();
    resolveDelete();
    await h.flush();
    expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({ id: 'same' }), expect.objectContaining({ mode: 'create' }));
  });

  it('serializes a disposed controller save before a replacement controller save', async () => {
    let resolveOld!: (value: unknown) => void;
    const oldSave = new Promise((resolve) => { resolveOld = resolve; });
    const coordinator = new DurabilityCoordinator();
    const commit = vi.fn().mockReturnValueOnce(oldSave).mockResolvedValueOnce({ status: 'saved', storageRevision: 1 });
    const old = harness({ commit: commit as never, coordinator });
    const replacement = harness({ commit: commit as never, coordinator });
    await old.lifecycle.startup();
    await replacement.lifecycle.startup();
    old.lifecycle.observeRevision(makeSession('same'), 1);
    await old.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    old.lifecycle.dispose();
    replacement.lifecycle.observeRevision({ ...makeSession('same'), updatedAt: 3 }, 2);
    await replacement.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    resolveOld({ status: 'saved', storageRevision: 1 });
    await old.flush();
    await replacement.flush();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls.map(([session]) => (session as WorkSession).updatedAt)).toEqual([2, 3]);
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
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0][0].documents[0].pdfBytes.byteLength).toBe(8);
  });

  it('startup revives a disposed controller so a StrictMode remount keeps autosaving', async () => {
    const h = harness();
    await h.lifecycle.startup();

    // React StrictMode: mount -> cleanup -> mount.
    h.lifecycle.dispose();
    await h.lifecycle.startup();

    h.lifecycle.observeRevision(makeSession('after-remount'), 1);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0][0].id).toBe('after-remount');
  });

  it('dispose cancels pending work and prevents in-flight completion consequences', async () => {
    let resolveSave!: (value: unknown) => void;
    const saving = new Promise((resolve) => { resolveSave = resolve; });
    const h = harness({ commit: async () => saving });
    await h.lifecycle.startup();
    h.lifecycle.startFresh('predecessor', () => undefined);
    h.lifecycle.observeRevision(makeSession('replacement'), 1);
    await h.flush();
    h.lifecycle.dispose();
    resolveSave({ status: 'saved', storageRevision: 1 });
    await h.flush();
    expect(h.deleteRecord).not.toHaveBeenCalledWith('predecessor', expect.anything());

    const pending = harness();
    await pending.lifecycle.startup();
    pending.lifecycle.observeRevision(makeSession('pending'), 1);
    pending.lifecycle.dispose();
    await pending.flush();
    expect(pending.commit).not.toHaveBeenCalled();
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
      commit: async () => ({ status: 'memory-only' as const, storageRevision: 1 }),
      startup: async () => ({ candidate: null, storageAvailable: false, storageProblem: 'unavailable' as const })
    });
    expect(h.lifecycle.getState().status).toBe('initializing');
    await h.lifecycle.startup();
    expect(h.lifecycle.getState().status).toBe('memory-only');
    h.lifecycle.observeRevision(makeSession('volatile'), 1);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.getState().status).toBe('memory-only');
  });

  it('saves the revision observed before startup completes without another edit', async () => {
    let resolveStartup!: (value: { candidate: WorkSession | null; storageAvailable: boolean }) => void;
    const startup = vi.fn(
      () => new Promise<{ candidate: WorkSession | null; storageAvailable: boolean }>((resolve) => { resolveStartup = resolve; })
    );
    const h = harness({ startup: startup as never });
    const settling = h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('before-startup'), 1);
    resolveStartup({ candidate: null, storageAvailable: true });
    await settling;
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0][0].id).toBe('before-startup');
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('keeps the latest revision dirty until its own save transaction completes', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const h = harness({ commit: vi.fn(async () => first) });
    await h.lifecycle.startup();

    h.lifecycle.observeRevision(makeSession('one'), 1);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('saving');

    h.lifecycle.observeRevision(makeSession('two'), 2);
    expect(h.lifecycle.getState().status).toBe('dirty');

    resolveFirst({ status: 'saved', storageRevision: 1 });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.lifecycle.getState().durableRevision).toBe(1);
    expect(h.lifecycle.getState().status).toBe('dirty');

    await h.flush();
    expect(h.lifecycle.getState().durableRevision).toBe(2);
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('flushLatest persists the undurable revision immediately', async () => {
    let resolveSave!: (value: unknown) => void;
    const h = harness({ commit: () => new Promise((resolve) => { resolveSave = resolve; }) });
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('pending'), 1);
    expect(h.pending()).toBe(1);
    expect(h.commit).not.toHaveBeenCalled();
    h.lifecycle.flushLatest();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.getState().status).toBe('saving');
    resolveSave({ status: 'saved', storageRevision: 1 });
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('flushLatest is a no-op once the latest revision is durable', async () => {
    const h = harness();
    await h.lifecycle.startup();
    h.lifecycle.observeRevision(makeSession('done'), 1);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    h.lifecycle.flushLatest();
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('reports the error status with visible copy when a save throws and clears it after a durable save', async () => {
    let fail = true;
    const h = harness({ commit: async () => { if (fail) throw new Error('disk'); return { status: 'saved' as const, storageRevision: 99 }; } });
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

  it('hands the commit the same source buffer references it captured', async () => {
    const h = harness();
    await h.lifecycle.startup();
    const source = new ArrayBuffer(8);
    const session = makeSession('shared');
    session.documents[0].pdfBytes = source;
    h.lifecycle.observeRevision(session, 1);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.commit.mock.calls[0][0].documents[0].pdfBytes).toBe(source);
  });
});

describe('guarded persistence and ownership', () => {
  it('saves with create semantics for a fresh session and update semantics for a loaded candidate', async () => {
    const h = harness({
      startup: async () => ({ candidate: makeSession('loaded'), storageAvailable: true, baseRevision: 3 })
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('loaded');
    h.lifecycle.observeRevision(makeSession('loaded'), 1);
    await h.flush();
    expect(h.commit).toHaveBeenCalledWith(expect.anything(), { mode: 'update', storageRevision: 3 });

    const fresh = harness();
    await fresh.lifecycle.startup();
    await fresh.lifecycle.assumeSession('brand-new');
    fresh.lifecycle.observeRevision(makeSession('brand-new'), 1);
    await fresh.flush();
    expect(fresh.commit).toHaveBeenCalledWith(expect.anything(), { mode: 'create' });
  });

  it('advances the base storage revision after every saved transaction even while newer work stays dirty', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const h = harness({ commit: vi.fn(async () => first) });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('token');

    h.lifecycle.observeRevision(makeSession('token'), 1);
    await h.flush();
    h.lifecycle.observeRevision(makeSession('token'), 2);
    expect(h.lifecycle.getState().status).toBe('dirty');

    resolveFirst({ status: 'saved', storageRevision: 7 });
    await h.flush();
    await h.flush();
    // The pending second save used the token returned by the first transaction.
    expect(h.commit).toHaveBeenNthCalledWith(2, expect.anything(), { mode: 'update', storageRevision: 7 });
    expect(h.lifecycle.getState()).toMatchObject({ status: 'saved', durableRevision: 2 });
  });

  it('keeps newer content dirty when a queued save lands before the next edit', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const h = harness({ commit: vi.fn(async () => first) });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('token');

    h.lifecycle.observeRevision(makeSession('token'), 1);
    await h.flush();
    h.lifecycle.observeRevision(makeSession('token'), 2);
    resolveFirst({ status: 'saved', storageRevision: 7 });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.lifecycle.getState().status).toBe('dirty');
    expect(h.lifecycle.getState().durableRevision).toBe(1);
  });

  it('reports a conflict with visible copy when another writer changed the record and stops autosaving', async () => {
    const h = harness({
      commit: async () => ({ status: 'conflict', reason: 'changed' })
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('contested');
    h.lifecycle.observeRevision(makeSession('contested'), 1);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('conflict');
    expect(h.lifecycle.getState().warning).toContain('another tab');

    h.lifecycle.observeRevision(makeSession('contested'), 2);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1); // suppressed after the conflict
    expect(h.lifecycle.getState().durableRevision).toBeNull();
  });

  it('recovers autosaving when ownership is assumed for a fresh session id after a conflict', async () => {
    const h = harness({
      commit: vi.fn(async () => ({ status: 'conflict', reason: 'changed' }))
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('contested');
    h.lifecycle.observeRevision(makeSession('contested'), 1);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('conflict');

    await h.lifecycle.assumeSession('independent');
    h.lifecycle.observeRevision(makeSession('independent'), 2);
    await h.flush();
    expect(h.commit).toHaveBeenNthCalledWith(2, expect.anything(), { mode: 'create' });
  });

  it('treats a version refusal as a conflict requiring a refresh', async () => {
    const h = harness({
      commit: async () => ({ status: 'refused', reason: 'version' })
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('legacy');
    h.lifecycle.observeRevision(makeSession('legacy'), 1);
    await h.flush();
    expect(h.lifecycle.getState().status).toBe('conflict');
    expect(h.lifecycle.getState().warning).toContain('refresh');
    h.lifecycle.observeRevision(makeSession('legacy'), 2);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('assumes ownership and downgrades to read-only when the lock is contended', async () => {
    const h = harness({
      acquireOwnership: async () => ({ status: 'contended' })
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('busy');
    expect(h.lifecycle.getState().authority).toBe('read-only');

    h.lifecycle.observeRevision(makeSession('busy'), 1);
    await h.flush();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('keeps editing optimistically when Web Locks are unavailable', async () => {
    const h = harness({
      acquireOwnership: async () => ({ status: 'unavailable' })
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('solo');
    expect(h.lifecycle.getState().authority).toBe('optimistic');
    h.lifecycle.observeRevision(makeSession('solo'), 1);
    await h.flush();
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.getState().status).toBe('saved');
  });

  it('releases ownership when ownership moves to another session id', async () => {
    const releases: number[] = [];
    let held = false;
    const h = harness({
      acquireOwnership: async () => {
        if (held) return { status: 'contended' };
        held = true;
        return { status: 'owned', release: async () => { held = false; releases.push(1); } };
      }
    });
    await h.lifecycle.startup();
    await h.lifecycle.assumeSession('first');
    expect(h.lifecycle.getState().authority).toBe('owner');
    await h.lifecycle.assumeSession('second');
    expect(releases).toHaveLength(1);
    expect(h.acquireOwnership).toHaveBeenNthCalledWith(2, 'second');
  });
});
