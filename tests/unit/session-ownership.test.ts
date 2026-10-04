import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSessionOwnership, sessionLockName, withSessionLock } from '../../src/lib/sessionOwnership';

/** Minimal Web Locks stand-in: exclusive named locks held until the callback's
 *  promise settles; ifAvailable contention resolves the callback with null. */
function fakeLockManager() {
  const held = new Map<string, Promise<void>>();
  const request = (name: string, options: { ifAvailable?: boolean }, callback: (lock: { name: string; mode?: string } | null) => unknown): Promise<unknown> => {
    if (options?.ifAvailable && held.has(name)) {
      return Promise.resolve(callback(null));
    }
    let releaseLock!: () => void;
    const untilReleased = new Promise<void>((resolve) => { releaseLock = resolve; });
    held.set(name, untilReleased);
    return Promise.resolve(callback({ name, mode: 'exclusive' as const })).then((result) => {
      releaseLock();
      held.delete(name);
      return result;
    });
  };
  return { request, held };
}

function stubLocks(manager: unknown) {
  Object.defineProperty(globalThis.navigator, 'locks', { value: manager, configurable: true });
}

function clearLocks() {
  const locks = globalThis.navigator as { locks?: unknown };
  delete locks.locks;
}

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe('session ownership', () => {
  afterEach(() => {
    clearLocks();
    vi.restoreAllMocks();
  });

  it('names locks per session id', () => {
    expect(sessionLockName('abc')).toBe('signlite:session:abc');
  });

  it('reports unavailable when Web Locks do not exist', async () => {
    clearLocks();
    expect(await acquireSessionOwnership('s1')).toEqual({ status: 'unavailable' });
    expect(await withSessionLock('s1', async () => 'ran')).toEqual({ status: 'unavailable' });
  });

  it('holds ownership until release and reports contention for other acquirers', async () => {
    const manager = fakeLockManager();
    stubLocks(manager);

    const first = await acquireSessionOwnership('s1');
    expect(first.status).toBe('owned');

    const second = await acquireSessionOwnership('s1');
    expect(second).toEqual({ status: 'contended' });

    if (first.status === 'owned') await first.release();
    await settle();
    const third = await acquireSessionOwnership('s1');
    expect(third.status).toBe('owned');
    if (third.status === 'owned') await third.release();
  });

  it('runs an operation under a short-held lock and skips when contended', async () => {
    const manager = fakeLockManager();
    stubLocks(manager);

    const ran = await withSessionLock('prune-me', async () => 'result');
    expect(ran).toEqual({ status: 'acquired', value: 'result' });

    // Hold the lock elsewhere, then try again.
    const external = await acquireSessionOwnership('prune-me');
    expect(external.status).toBe('owned');
    const skipped = await withSessionLock('prune-me', async () => 'result');
    expect(skipped).toEqual({ status: 'contended' });
    if (external.status === 'owned') await external.release();
    await settle();
  });

  it('treats a throwing lock request as unavailable', async () => {
    stubLocks({
      request: () => Promise.reject(new DOMException('denied', 'SecurityError'))
    });
    expect(await acquireSessionOwnership('s1')).toEqual({ status: 'unavailable' });
  });
});
