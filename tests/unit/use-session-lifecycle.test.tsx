import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkSession } from '../../src/db/schema';

const mocks = vi.hoisted(() => ({ createActiveSessionLifecycle: vi.fn() }));

// Keep the real ActiveSessionLifecycle and mock only the production factory,
// so these tests drive the actual hook with the actual durability class.
vi.mock('../../src/lib/sessionLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/sessionLifecycle')>();
  return { ...actual, createActiveSessionLifecycle: mocks.createActiveSessionLifecycle };
});

import { ActiveSessionLifecycle, type StartupResult } from '../../src/lib/sessionLifecycle';
import { useSessionLifecycle } from '../../src/lib/useSessionLifecycle';

const session = (id: string): WorkSession => ({ id, createdAt: 1, updatedAt: 2, documents: [], templatePlacements: [] });
const sessionWithDoc = (id: string): WorkSession => ({
  id,
  createdAt: 1,
  updatedAt: 2,
  documents: [{ docId: 'd', fileName: 'a.pdf', pdfBytes: new ArrayBuffer(8), pageCount: 1, pageSizes: [{ w: 612, h: 792 }], placements: [], status: 'pending' as const }],
  templatePlacements: []
});

function controller() {
  const unsubscribe = vi.fn();
  return {
    subscribe: vi.fn(() => unsubscribe),
    getState: vi.fn(() => ({ ready: true, candidate: session('predecessor'), mode: 'persistent' as const, warning: null })),
    startup: vi.fn().mockResolvedValue(undefined),
    observeRevision: vi.fn(),
    dismissCandidate: vi.fn(),
    startFresh: vi.fn(),
    dispose: vi.fn(),
    unsubscribe
  };
}

type TimerHarness = {
  flushDebounces: () => void;
  drain: () => Promise<void>;
};

function realLifecycle(options: { startup?: () => Promise<StartupResult>; save?: (session: WorkSession) => Promise<'persistent' | 'memory'> } = {}) {
  const timers = new Map<number, () => void>();
  let next = 1;
  const fallbackStartup = async (): Promise<StartupResult> => ({ candidate: null, storageAvailable: true });
  const save = vi.fn(options.save ?? (async () => 'persistent' as const));
  const lifecycle = new ActiveSessionLifecycle({
    startup: options.startup ?? fallbackStartup,
    save,
    clear: vi.fn(async () => undefined),
    storage: null,
    schedule: (callback) => {
      const id = next;
      next += 1;
      timers.set(id, callback);
      return id;
    },
    cancel: (id) => { timers.delete(id); }
  });
  const harness: TimerHarness = {
    flushDebounces: () => {
      const pending = [...timers.values()];
      timers.clear();
      act(() => {
        for (const callback of pending) callback();
      });
    },
    drain: async () => {
      await act(async () => {
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
      });
    }
  };
  return { lifecycle, save, ...harness };
}

describe('useSessionLifecycle', () => {
  beforeEach(() => mocks.createActiveSessionLifecycle.mockReset());

  it('starts, observes only contentRevision with latest session, forwards Start Fresh, and disposes', () => {
    const lifecycle = controller();
    mocks.createActiveSessionLifecycle.mockReturnValue(lifecycle);
    const resetSession = vi.fn();
    const { result, rerender, unmount } = renderHook(({ current, revision }) => useSessionLifecycle({ session: current, contentRevision: revision, resetSession }), { initialProps: { current: session('one'), revision: 1 } });
    expect(lifecycle.startup).toHaveBeenCalledOnce();
    expect(lifecycle.observeRevision).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'one' }), 1);
    rerender({ current: session('view-only'), revision: 1 });
    expect(lifecycle.observeRevision).toHaveBeenCalledTimes(1);
    rerender({ current: session('latest'), revision: 2 });
    expect(lifecycle.observeRevision).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'latest' }), 2);
    act(() => result.current.startFresh());
    expect(lifecycle.startFresh).toHaveBeenCalledWith('predecessor', resetSession);
    act(() => result.current.resumeSucceeded());
    expect(lifecycle.dismissCandidate).toHaveBeenCalled();
    unmount();
    expect(lifecycle.unsubscribe).toHaveBeenCalled();
    expect(lifecycle.dispose).toHaveBeenCalled();
  });

  it('saves the latest revision observed before startup resolves, without another edit', async () => {
    let resolveStartup!: (value: StartupResult) => void;
    const { lifecycle, save, flushDebounces, drain } = realLifecycle({
      startup: () => new Promise<StartupResult>((resolve) => { resolveStartup = resolve; })
    });
    mocks.createActiveSessionLifecycle.mockReturnValue(lifecycle);

    const { rerender } = renderHook(
      ({ revision }) => useSessionLifecycle({ session: sessionWithDoc('before-startup'), contentRevision: revision, resetSession: () => undefined }),
      { initialProps: { revision: 1 } }
    );
    // An edit lands while startup is still pending.
    rerender({ revision: 2 });
    await drain();
    expect(save).not.toHaveBeenCalled();

    resolveStartup({ candidate: null, storageAvailable: true });
    await drain();
    // No further edit: the buffered latest revision must save on its own.
    flushDebounces();
    await drain();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].id).toBe('before-startup');
  });

  it('keeps autosaving after a StrictMode mount-cleanup-mount cycle', async () => {
    const timers = new Map<number, () => void>();
    let next = 1;
    const save = vi.fn(async (session: WorkSession) => {
      void session;
      return 'persistent' as const;
    });
    const startup = vi.fn(async (): Promise<StartupResult> => ({ candidate: null, storageAvailable: true }));
    const lifecycle = new ActiveSessionLifecycle({
      startup,
      save,
      clear: vi.fn(async () => undefined),
      storage: null,
      schedule: (callback) => {
        const id = next;
        next += 1;
        timers.set(id, callback);
        return id;
      },
      cancel: (id) => { timers.delete(id); }
    });
    mocks.createActiveSessionLifecycle.mockReturnValue(lifecycle);

    const { rerender } = renderHook(
      ({ revision }) => useSessionLifecycle({ session: sessionWithDoc('strict'), contentRevision: revision, resetSession: () => undefined }),
      {
        initialProps: { revision: 1 },
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>
      }
    );
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    // StrictMode runs mount -> cleanup -> mount; startup must have run twice.
    expect(startup).toHaveBeenCalledTimes(2);

    rerender({ revision: 2 });
    act(() => {
      for (const callback of timers.values()) callback();
      timers.clear();
    });
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].id).toBe('strict');
  });

  it('flushes the undurable revision when the tab hides', async () => {
    const { lifecycle, save, drain } = realLifecycle();
    mocks.createActiveSessionLifecycle.mockReturnValue(lifecycle);

    const { result } = renderHook(
      ({ revision }) => useSessionLifecycle({ session: sessionWithDoc('hidden'), contentRevision: revision, resetSession: () => undefined }),
      { initialProps: { revision: 1 } }
    );
    await drain();
    expect(save).not.toHaveBeenCalled();

    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await drain();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].id).toBe('hidden');

    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await drain();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('registers beforeunload protection only while work is undurable', async () => {
    const { lifecycle, flushDebounces, drain } = realLifecycle();
    mocks.createActiveSessionLifecycle.mockReturnValue(lifecycle);

    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(
      ({ revision }) => useSessionLifecycle({ session: sessionWithDoc('leave'), contentRevision: revision, resetSession: () => undefined }),
      { initialProps: { revision: 1 } }
    );
    await drain();
    flushDebounces();
    await drain();
    // Protection registers while undurable (dirty and saving states) and every
    // registered handler is removed once the save completes.
    const registered = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    const removed = removeSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(registered.length).toBeGreaterThanOrEqual(1);
    expect(registered.length).toBe(removed.length);
    expect(removed[removed.length - 1][1]).toBe(registered[registered.length - 1][1]);
    expect(addSpy.mock.calls.length).toBe(registered.length);

    unmount();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
