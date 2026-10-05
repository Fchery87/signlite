import { commitSession, deleteIfUnchanged, historyStorageProblem, isUsingMemoryHistory, loadLatestSession, pruneOldSessions } from '../db/history';
import type { CommitExpectation, CommitResult, DeleteResult } from '../db/history';
import { hydrateSignaturePrefs, isUsingMemoryStore } from '../db/signatures';
import { normalizeSession } from './normalizeSession';
import { acquireSessionOwnership, withSessionLock, type OwnershipResult } from './sessionOwnership';
import type { WorkSession } from '../db/schema';

export interface StartupResult {
  candidate: WorkSession | null;
  storageAvailable: boolean;
  storageProblem?: 'unavailable' | 'upgrade-blocked' | null;
  /** Storage revision of the loaded candidate record, when found. */
  baseRevision?: number;
}

export async function startupAndDiscover(): Promise<StartupResult> {
  const storageAvailable = !isUsingMemoryStore() && !isUsingMemoryHistory();
  // Pruning and preference discovery are cleanup and convenience work. Their
  // failure must not abort autosave initialization.
  try {
    // Hold each victim's session lock while deleting it, so a live owner in
    // another tab never loses its record. Without Web Locks, skip deletion.
    await pruneOldSessions(Date.now() - 7 * 24 * 60 * 60 * 1000, async (id, operation) => {
      return (await withSessionLock(id, operation)).status === 'acquired';
    });
  } catch {
    // Cleanup failure: discovery still proceeds.
  }
  try {
    await hydrateSignaturePrefs();
  } catch {
    // Preference failure: the library still works with defaults.
  }
  const storageProblem = historyStorageProblem();
  const latest = await loadLatestSession();
  if (latest.status !== 'found') return { candidate: null, storageAvailable, storageProblem };
  try {
    return { candidate: await normalizeSession(latest.session), storageAvailable, storageProblem, baseRevision: latest.storageRevision };
  } catch {
    return { candidate: null, storageAvailable, storageProblem };
  }
}

export type DurabilityStatus = 'initializing' | 'saved' | 'dirty' | 'saving' | 'memory-only' | 'error' | 'conflict';

/** Editing authority for the current session. 'read-only' tabs never write;
 *  'optimistic' tabs write with revision guards but no cross-tab lock. */
export type SessionAuthority = 'owner' | 'read-only' | 'optimistic';

export type DurabilityState = {
  ready: boolean;
  status: DurabilityStatus;
  candidate: WorkSession | null;
  mode: 'persistent' | 'memory';
  warning: string | null;
  /** Latest content revision whose save transaction completed durably. */
  durableRevision: number | null;
  authority: SessionAuthority;
};

const STORAGE_UNAVAILABLE_WARNING = 'Browser storage is unavailable. This Work Session is kept only in this tab and will not survive reload.';
const STORAGE_UPGRADE_BLOCKED_WARNING = 'This browser blocked the storage upgrade. Your work is kept in this tab only and will not survive reload.';
const MEMORY_AUTOSAVE_WARNING = 'Autosave is using memory only. Changes will not survive reload.';
const AUTOSAVE_FAILED_WARNING = 'Autosave failed. Your latest changes may not survive reload.';
const CONFLICT_WARNING = 'This Work Session changed in another tab. Your latest changes were not saved. Use Start Fresh to keep an independent copy.';
const REFRESH_REQUIRED_WARNING = 'This Work Session could not be saved because storage needs a refresh. Reload the page to continue editing safely.';

type LifecycleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class DurabilityCoordinator {
  private tail: Promise<void> = Promise.resolve();

  enqueue(operation: () => Promise<void>) {
    this.tail = this.tail.catch(() => undefined).then(operation);
    return this.tail;
  }
}

type LifecycleDependencies = {
  startup: () => Promise<StartupResult>;
  commit: (session: WorkSession, expected: CommitExpectation) => Promise<CommitResult>;
  deleteRecord: (id: string, expectedRevision: number) => Promise<DeleteResult>;
  acquireOwnership: (id: string) => Promise<OwnershipResult>;
  storage: LifecycleStorage | null;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (handle: number) => void;
  coordinator?: DurabilityCoordinator;
};

const productionDurabilityCoordinator = new DurabilityCoordinator();

function cloneSession(session: WorkSession): WorkSession {
  return {
    ...session,
    documents: session.documents.map((document) => ({
      ...document,
      // Source PDF buffers are immutable after intake. Keep the reference here
      // and let IndexedDB perform its structured clone during save. Copying
      // every source buffer during a batch status update creates avoidable
      // main-thread long tasks.
      pdfBytes: document.pdfBytes,
      pageSizes: document.pageSizes.map((page) => ({ ...page })),
      placements: document.placements.map((placement) => ({ ...placement }))
    })),
    templatePlacements: session.templatePlacements.map((placement) => ({ ...placement })),
    signatureSnapshots: Object.fromEntries(Object.entries(session.signatureSnapshots ?? {}).map(([id, snapshot]) => [
      id,
      { ...snapshot, pngBytes: snapshot.pngBytes }
    ]))
  };
}

type ObservedRevision = { session: WorkSession; revision: number };

export class ActiveSessionLifecycle {
  private state: DurabilityState = { ready: false, status: 'initializing', candidate: null, mode: 'persistent', warning: null, durableRevision: null, authority: 'optimistic' };
  private lastObserved: ObservedRevision | null = null;
  private lastRevision: number | null = null;
  private inFlightRevision: number | null = null;
  private pendingSave: number | null = null;
  private generation = 0;
  private readonly coordinator: DurabilityCoordinator;
  private disposed = false;
  private listeners = new Set<(state: DurabilityState) => void>();
  /** Optimistic-concurrency token for baseRevisionFor's record. */
  private baseRevision: number | null = null;
  private baseRevisionFor: string | null = null;
  private suppressed = false;
  private ownershipRelease: (() => Promise<void>) | null = null;
  private authorityFor: string | null = null;
  private ownershipAssumed = false;

  constructor(private readonly deps: LifecycleDependencies) {
    this.coordinator = deps.coordinator ?? new DurabilityCoordinator();
  }

  subscribe(listener: (state: DurabilityState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  private update(change: Partial<DurabilityState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }

  async startup() {
    // startup() is the mount half of the dispose() pair. React StrictMode runs
    // mount -> cleanup -> mount, so an instance must be usable again after
    // dispose() or autosave stays dead for the life of the tab.
    this.disposed = false;
    this.suppressed = false;
    const result = await this.deps.startup();
    if (this.disposed) return;
    const mode: DurabilityState['mode'] = result.storageAvailable ? 'persistent' : 'memory';
    let status: DurabilityStatus = 'saved';
    let warning: string | null = null;
    if (!result.storageAvailable) {
      status = 'memory-only';
      warning = STORAGE_UNAVAILABLE_WARNING;
    } else if (result.storageProblem === 'upgrade-blocked') {
      status = 'conflict';
      warning = STORAGE_UPGRADE_BLOCKED_WARNING;
      this.suppressed = true;
    }
    this.baseRevisionFor = result.candidate?.id ?? null;
    this.baseRevision = result.baseRevision ?? null;
    this.update({ ready: true, status, candidate: result.candidate, mode, warning, durableRevision: null });
    // Revisions observed before readiness are buffered, not dropped; process
    // the latest of them now.
    this.processLatestRevision();
  }

  /** Takes responsibility for one session id: acquires its editing lock, and
   *  on contention downgrades this tab to read-only for that session. */
  async assumeSession(id: string) {
    if (this.disposed) return;
    // Ownership change invalidates queued writes from the previous identity:
    // cancel the pending debounce and let generation guards drop stale ops.
    if (this.pendingSave !== null) {
      this.deps.cancel(this.pendingSave);
      this.pendingSave = null;
    }
    this.generation += 1;
    if (this.ownershipRelease) {
      const release = this.ownershipRelease;
      this.ownershipRelease = null;
      await release();
    }
    const result = await this.deps.acquireOwnership(id);
    if (this.disposed) {
      if (result.status === 'owned') await result.release();
      return;
    }
    this.ownershipAssumed = true;
    if (result.status === 'owned') this.ownershipRelease = result.release;
    const authority: SessionAuthority = result.status === 'owned' ? 'owner' : result.status === 'contended' ? 'read-only' : 'optimistic';
    this.authorityFor = id;
    this.suppressed = false;
    // A storage token belongs to the record it was read from. A different
    // session id starts with no record: its first save creates one.
    if (this.baseRevisionFor !== id) {
      this.baseRevisionFor = id;
      this.baseRevision = null;
    }
    this.update({ authority });
    // Reprocess the buffered observation under the settled authority: a save
    // skipped while the identity was in transition must not stay lost.
    this.lastRevision = null;
    this.processLatestRevision();
  }

  dismissCandidate() {
    this.update({ candidate: null });
  }

  /** Cancels queued saves and invalidates in-flight generations ahead of a
   *  local-data wipe: a queued autosave must not resurrect cleared records. */
  prepareForLocalDataClear() {
    if (this.disposed) return;
    if (this.pendingSave !== null) {
      this.deps.cancel(this.pendingSave);
      this.pendingSave = null;
    }
    this.generation += 1;
    this.lastRevision = null;
  }

  startFresh(_predecessorId: string, reset: () => void) {
    // No predecessor marker and no eager deletion: the older record is left in
    // place, and history pruning removes it once it expires.
    this.dismissCandidate();
    reset();
  }

  observeRevision(session: WorkSession, revision: number) {
    if (this.disposed) return;
    this.lastObserved = { session, revision };
    this.processLatestRevision();
  }

  /** Persists the latest observed revision immediately instead of waiting for
   *  the debounce. Used for visibility changes and explicit close actions. */
  flushLatest() {
    if (this.disposed || !this.state.ready) return;
    if (this.suppressed || this.state.authority === 'read-only') return;
    const observed = this.lastObserved;
    if (!observed) return;
    if (observed.revision <= 0 && observed.session.documents.length === 0) return;
    const hasPendingDebounce = this.pendingSave !== null;
    const alreadyInFlight = this.inFlightRevision === observed.revision;
    const durable = (this.state.durableRevision ?? Number.NEGATIVE_INFINITY) >= observed.revision;
    if (!hasPendingDebounce && (alreadyInFlight || durable)) return;
    if (this.pendingSave !== null) {
      const pending = this.pendingSave;
      this.deps.cancel(pending);
      this.pendingSave = null;
    }
    this.lastRevision = observed.revision;
    this.commitObserved(observed, ++this.generation);
  }

  private processLatestRevision() {
    if (this.disposed || !this.state.ready) return;
    if (this.suppressed || this.state.authority === 'read-only') return;
    const observed = this.lastObserved;
    if (!observed || observed.revision === this.lastRevision) return;
    this.lastRevision = observed.revision;
    // A pristine load (initial revision, no documents) has nothing to make durable.
    if (observed.revision <= 0 && observed.session.documents.length === 0) return;
    const generation = ++this.generation;
    if (this.pendingSave !== null) {
      this.deps.cancel(this.pendingSave);
      this.pendingSave = null;
    }
    this.update({ status: 'dirty' });
    this.pendingSave = this.deps.schedule(() => {
      this.pendingSave = null;
      // Authority can change while the debounce is pending (a resumed session
      // turns read-only, or a new identity is not assumed yet). Re-check at
      // fire time; never write without an aligned, writable authority.
      if (this.suppressed || this.state.authority === 'read-only') return;
      // Once ownership tracking is active, only the assumed identity may write.
      if (this.ownershipAssumed && this.authorityFor !== observed.session.id) return;
      this.commitObserved(observed, generation);
    }, 500);
  }

  private commitObserved(observed: ObservedRevision, generation: number) {
    if (observed.session.documents.length === 0) {
      this.update({ status: 'saving' });
      // The stale-clear guard is only disposal, not generation: a queued clear
      // must run before a newer save so an empty pass never resurrects data.
      void this.coordinator.enqueue(async () => {
        if (this.disposed) return;
        const expected = this.baseRevisionFor === observed.session.id && this.baseRevision !== null ? this.baseRevision : 0;
        await this.deps.deleteRecord(observed.session.id, expected);
        if (this.disposed || generation !== this.generation) return;
        this.completeRevision(observed.revision, 'persistent');
      });
      return;
    }

    // Clone inside the debounce window, not per revision. Every pointer move
    // during a placement drag lands here, and cloning eagerly copied every
    // pdfBytes buffer in the Work Session on each one. The captured session is
    // already an immutable snapshot, so deferring the copy preserves the bytes.
    const snapshot = cloneSession(observed.session);
    this.inFlightRevision = observed.revision;
    this.update({ status: 'saving' });
    this.enqueue(generation, async () => this.persist(snapshot, observed.revision, generation));
  }

  private enqueue(generation: number, operation: () => Promise<void>) {
    void this.coordinator.enqueue(async () => {
      if (this.disposed || generation !== this.generation) return;
      await operation();
    });
  }

  /** Marks a revision durable and derives the public status from it. Memory
   *  outcomes are never reported as saved. */
  private completeRevision(revision: number, outcome: 'persistent' | 'memory' = 'persistent') {
    const status: DurabilityStatus = outcome === 'memory'
      ? 'memory-only'
      : (this.lastRevision ?? revision) > revision ? 'dirty' : 'saved';
    this.update({ durableRevision: Math.max(revision, this.state.durableRevision ?? 0), status });
  }

  private async persist(session: WorkSession, revision: number, generation: number) {
    const expected: CommitExpectation = this.baseRevisionFor === session.id && this.baseRevision !== null
      ? { mode: 'update', storageRevision: this.baseRevision }
      : { mode: 'create' };
    try {
      const result = await this.deps.commit(session, expected);
      if (this.disposed) return;
      this.inFlightRevision = null;
      if (result.status === 'conflict') {
        this.suppressed = true;
        this.update({ status: 'conflict', warning: this.state.warning ?? CONFLICT_WARNING });
        return;
      }
      if (result.status === 'refused') {
        this.suppressed = true;
        this.update({ status: 'conflict', warning: this.state.warning ?? REFRESH_REQUIRED_WARNING });
        return;
      }
      // Both durable and memory outcomes advance the base token: a superseded
      // save still wrote its bytes, and a newer revision immediately turns the
      // state dirty again while reusing the returned token.
      this.baseRevisionFor = session.id;
      this.baseRevision = result.storageRevision;
      const isCurrent = generation === this.generation;
      if (result.status === 'memory-only') {
        if (isCurrent) this.update({ mode: 'memory', warning: this.state.warning ?? MEMORY_AUTOSAVE_WARNING });
        this.completeRevision(revision, 'memory');
        return;
      }
      if (isCurrent) this.update({ mode: 'persistent', warning: null });
      this.completeRevision(revision, 'persistent');
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.inFlightRevision = null;
      this.update({ status: 'error', warning: this.state.warning ?? AUTOSAVE_FAILED_WARNING });
    }
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    if (this.pendingSave !== null) this.deps.cancel(this.pendingSave);
    this.pendingSave = null;
    if (this.ownershipRelease) {
      const release = this.ownershipRelease;
      this.ownershipRelease = null;
      void release();
    }
    this.listeners.clear();
  }
}

export function createActiveSessionLifecycle(): ActiveSessionLifecycle {
  return new ActiveSessionLifecycle({
    startup: startupAndDiscover,
    commit: commitSession,
    deleteRecord: deleteIfUnchanged,
    acquireOwnership: acquireSessionOwnership,
    storage: typeof localStorage === 'undefined' ? null : localStorage,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (handle) => window.clearTimeout(handle),
    coordinator: productionDurabilityCoordinator
  });
}
