import { clearSession, historyStorageProblem, isUsingMemoryHistory, loadLatestSession, pruneOldSessions, saveSession, type SaveSessionOutcome } from '../db/history';
import { hydrateSignaturePrefs, isUsingMemoryStore } from '../db/signatures';
import { normalizeSession } from './normalizeSession';
import type { WorkSession } from '../db/schema';

export interface StartupResult {
  candidate: WorkSession | null;
  storageAvailable: boolean;
  storageProblem?: 'unavailable' | 'upgrade-blocked' | null;
}

export async function startupAndDiscover(): Promise<StartupResult> {
  const storageAvailable = !isUsingMemoryStore() && !isUsingMemoryHistory();
  // Pruning and preference discovery are cleanup and convenience work. Their
  // failure must not abort autosave initialization.
  try {
    await pruneOldSessions();
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
  if (!latest) return { candidate: null, storageAvailable, storageProblem };
  try {
    return { candidate: await normalizeSession(latest), storageAvailable, storageProblem };
  } catch {
    return { candidate: null, storageAvailable, storageProblem };
  }
}

export type DurabilityStatus = 'initializing' | 'saved' | 'dirty' | 'saving' | 'memory-only' | 'error' | 'conflict';

export type DurabilityState = {
  ready: boolean;
  status: DurabilityStatus;
  candidate: WorkSession | null;
  mode: 'persistent' | 'memory';
  warning: string | null;
  /** Latest content revision whose save transaction completed durably. */
  durableRevision: number | null;
};

const STORAGE_UNAVAILABLE_WARNING = 'Browser storage is unavailable. This Work Session is kept only in this tab and will not survive reload.';
const STORAGE_UPGRADE_BLOCKED_WARNING = 'This browser blocked the storage upgrade. Your work is kept in this tab only and will not survive reload.';
const MEMORY_AUTOSAVE_WARNING = 'Autosave is using memory only. Changes will not survive reload.';
const AUTOSAVE_FAILED_WARNING = 'Autosave failed. Your latest changes may not survive reload.';

type RetainedPredecessor = { predecessorId: string; replacementId?: string };

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
  save: (session: WorkSession) => Promise<SaveSessionOutcome>;
  clear: (id: string) => Promise<void>;
  storage: LifecycleStorage | null;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (handle: number) => void;
  coordinator?: DurabilityCoordinator;
};

const RETAINED_PREDECESSOR_KEY = 'signlite:retained-predecessor';
const productionDurabilityCoordinator = new DurabilityCoordinator();

function readRetained(storage: LifecycleStorage | null): RetainedPredecessor | null {
  try {
    const value = storage?.getItem(RETAINED_PREDECESSOR_KEY);
    return value ? JSON.parse(value) as RetainedPredecessor : null;
  } catch {
    return null;
  }
}

function writeRetained(storage: LifecycleStorage | null, value: RetainedPredecessor | null) {
  try {
    if (value) storage?.setItem(RETAINED_PREDECESSOR_KEY, JSON.stringify(value));
    else storage?.removeItem(RETAINED_PREDECESSOR_KEY);
  } catch {
    // Durable session retention remains safe even when marker storage is unavailable.
  }
}

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
  private state: DurabilityState = { ready: false, status: 'initializing', candidate: null, mode: 'persistent', warning: null, durableRevision: null };
  private lastObserved: ObservedRevision | null = null;
  private lastRevision: number | null = null;
  private inFlightRevision: number | null = null;
  private pendingSave: number | null = null;
  private generation = 0;
  private readonly coordinator: DurabilityCoordinator;
  private disposed = false;
  private retained: RetainedPredecessor | null;
  private readonly listeners = new Set<(state: DurabilityState) => void>();

  constructor(private readonly deps: LifecycleDependencies) {
    this.retained = readRetained(deps.storage);
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
    }
    this.update({ ready: true, status, candidate: result.candidate, mode, warning, durableRevision: null });
    // Revisions observed before readiness are buffered, not dropped; process
    // the latest of them now.
    this.processLatestRevision();
  }

  dismissCandidate() {
    this.update({ candidate: null });
  }

  startFresh(predecessorId: string, reset: () => void) {
    this.retained = { predecessorId };
    writeRetained(this.deps.storage, this.retained);
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
      this.commitObserved(observed, generation);
    }, 500);
  }

  private commitObserved(observed: ObservedRevision, generation: number) {
    if (this.retained && !this.retained.replacementId && observed.session.id !== this.retained.predecessorId) {
      this.retained = { ...this.retained, replacementId: observed.session.id };
      writeRetained(this.deps.storage, this.retained);
    }

    if (observed.session.documents.length === 0) {
      if (observed.session.id !== this.retained?.predecessorId) {
        this.update({ status: 'saving' });
        this.enqueue(generation, async () => {
          await this.deps.clear(observed.session.id);
          if (this.disposed || generation !== this.generation) return;
          this.completeRevision(observed.revision);
        });
      }
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
  private completeRevision(revision: number, outcome: SaveSessionOutcome = 'persistent') {
    const status: DurabilityStatus = outcome === 'memory'
      ? 'memory-only'
      : (this.lastRevision ?? revision) > revision ? 'dirty' : 'saved';
    this.update({ durableRevision: Math.max(revision, this.state.durableRevision ?? 0), status });
  }

  private async persist(session: WorkSession, revision: number, generation: number) {
    try {
      const outcome = await this.deps.save(session);
      if (this.disposed) return;
      this.inFlightRevision = null;
      const isCurrent = generation === this.generation;
      // A superseded save still wrote its bytes; record the revision as durable
      // even though a newer revision immediately makes the state dirty again.
      if (outcome === 'memory') {
        if (isCurrent) this.update({ mode: 'memory', warning: this.state.warning ?? MEMORY_AUTOSAVE_WARNING });
        this.completeRevision(revision, 'memory');
        return;
      }
      if (isCurrent) this.update({ mode: 'persistent', warning: null });
      this.completeRevision(revision, 'persistent');
      if (!isCurrent) return;
      if (this.retained?.replacementId === session.id && this.retained.predecessorId !== session.id) {
        const predecessorId = this.retained.predecessorId;
        await Promise.resolve();
        if (this.disposed || generation !== this.generation) return;
        await this.deps.clear(predecessorId);
        if (this.disposed || generation !== this.generation) return;
        this.retained = null;
        writeRetained(this.deps.storage, null);
      }
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
    this.listeners.clear();
  }
}

export function createActiveSessionLifecycle(): ActiveSessionLifecycle {
  return new ActiveSessionLifecycle({
    startup: startupAndDiscover,
    save: saveSession,
    clear: clearSession,
    storage: typeof localStorage === 'undefined' ? null : localStorage,
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (handle) => window.clearTimeout(handle),
    coordinator: productionDurabilityCoordinator
  });
}
