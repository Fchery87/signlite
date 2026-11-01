/** Cross-tab session ownership built on the Web Locks API. Ownership gates
 *  editing and destructive history work; transactional storage-revision checks
 *  remain the correctness guarantee in every browser. */

export type OwnershipResult =
  | { status: 'owned'; release: () => Promise<void> }
  | { status: 'contended' }
  | { status: 'unavailable' };

export type LockOutcome<T> =
  | { status: 'acquired'; value: T }
  | { status: 'contended' }
  | { status: 'unavailable' };

type LockManagerLike = {
  request: (name: string, options: { ifAvailable?: boolean; mode?: 'shared' | 'exclusive' }, callback: (lock: { name: string } | null) => unknown) => Promise<unknown>;
};

function lockManager(): LockManagerLike | null {
  const locks = (globalThis.navigator as { locks?: LockManagerLike }).locks;
  return locks ?? null;
}

export function sessionLockName(id: string): string {
  return `signlite:session:${id}`;
}

/** Nonblocking acquisition of a session's editing lock. The lock is held until
 *  release() is called; a held lock makes every other acquirer contended. */
export async function acquireSessionOwnership(id: string): Promise<OwnershipResult> {
  const locks = lockManager();
  if (!locks) return { status: 'unavailable' };
  const name = sessionLockName(id);
  return new Promise<OwnershipResult>((resolve) => {
    let releaseLock: (() => void) | null = null;
    const untilReleased = new Promise<void>((resolveRelease) => { releaseLock = resolveRelease; });
    const request = locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve({ status: 'contended' });
        return;
      }
      resolve({
        status: 'owned',
        release: async () => {
          releaseLock?.();
          await request;
        }
      });
      return untilReleased;
    });
    void request.catch(() => {
      resolve({ status: 'unavailable' });
    });
  });
}

/** Runs an operation while briefly holding a session's lock. Contended or
 *  unavailable locks yield a skip outcome instead of running the operation. */
export async function withSessionLock<T>(id: string, operation: () => Promise<T>): Promise<LockOutcome<T>> {
  return withNamedLock(sessionLockName(id), 'exclusive', operation);
}

export const ORIGIN_MAINTENANCE_LOCK_NAME = 'signlite:maintenance:v1';

export async function acquireOriginParticipation(): Promise<OwnershipResult> {
  const locks = lockManager();
  if (!locks) return { status: 'unavailable' };
  return new Promise<OwnershipResult>((resolve) => {
    let releaseLock: (() => void) | null = null;
    const untilReleased = new Promise<void>((release) => { releaseLock = release; });
    const request = locks.request(ORIGIN_MAINTENANCE_LOCK_NAME, { ifAvailable: true, mode: 'shared' }, (lock) => {
      if (!lock) {
        resolve({ status: 'contended' });
        return;
      }
      resolve({ status: 'owned', release: async () => { releaseLock?.(); await request; } });
      return untilReleased;
    });
    void request.catch(() => resolve({ status: 'unavailable' }));
  });
}

export function withOriginMaintenance<T>(operation: () => Promise<T>): Promise<LockOutcome<T>> {
  return withNamedLock(ORIGIN_MAINTENANCE_LOCK_NAME, 'shared', operation);
}

export function withExclusiveMaintenance<T>(operation: () => Promise<T>): Promise<LockOutcome<T>> {
  return withNamedLock(ORIGIN_MAINTENANCE_LOCK_NAME, 'exclusive', operation);
}

async function withNamedLock<T>(name: string, mode: 'shared' | 'exclusive', operation: () => Promise<T>): Promise<LockOutcome<T>> {
  const locks = lockManager();
  if (!locks) return { status: 'unavailable' };
  let entered = false;
  let outcome: LockOutcome<T> = { status: 'contended' };
  try {
    await locks.request(name, { ifAvailable: true, mode }, async (lock) => {
      if (!lock) return;
      entered = true;
      outcome = { status: 'acquired', value: await operation() };
    });
    return outcome;
  } catch (error) {
    if (entered) throw error;
    return { status: 'unavailable' };
  }
}
