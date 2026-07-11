import { clearSession, isUsingMemoryHistory, loadLatestSession, pruneOldSessions, saveSession, type SaveSessionOutcome } from '../db/history';
import { hydrateSignaturePrefs, isUsingMemoryStore } from '../db/signatures';
import { normalizeSession } from './normalizeSession';
import type { WorkSession } from '../db/schema';

export interface StartupResult {
  candidate: WorkSession | null;
  storageAvailable: boolean;
}

export async function startupAndDiscover(): Promise<StartupResult> {
  await pruneOldSessions();
  await hydrateSignaturePrefs();
  const latest = await loadLatestSession();
  const storageAvailable = !isUsingMemoryStore() && !isUsingMemoryHistory();
  if (!latest) return { candidate: null, storageAvailable };
  try {
    return { candidate: await normalizeSession(latest), storageAvailable };
  } catch {
    return { candidate: null, storageAvailable };
  }
}

export type DurabilityState = {
  ready: boolean;
  candidate: WorkSession | null;
  mode: 'persistent' | 'memory';
  warning: string | null;
};

type RetainedPredecessor = { predecessorId: string; replacementId?: string };

type LifecycleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type LifecycleDependencies = {
  startup: () => Promise<StartupResult>;
  save: (session: WorkSession) => Promise<SaveSessionOutcome>;
  clear: (id: string) => Promise<void>;
  storage: LifecycleStorage | null;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (handle: number) => void;
};

const RETAINED_PREDECESSOR_KEY = 'signlite:retained-predecessor';

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
      pdfBytes: document.pdfBytes.slice(0),
      pageSizes: document.pageSizes.map((page) => ({ ...page })),
      placements: document.placements.map((placement) => ({ ...placement }))
    })),
    templatePlacements: session.templatePlacements.map((placement) => ({ ...placement })),
    signatureSnapshots: Object.fromEntries(Object.entries(session.signatureSnapshots ?? {}).map(([id, snapshot]) => [
      id,
      { ...snapshot, pngBytes: snapshot.pngBytes.slice(0) }
    ]))
  };
}

export class ActiveSessionLifecycle {
  private state: DurabilityState = { ready: false, candidate: null, mode: 'persistent', warning: null };
  private lastRevision: number | null = null;
  private pendingSave: number | null = null;
  private retained: RetainedPredecessor | null;
  private readonly listeners = new Set<(state: DurabilityState) => void>();

  constructor(private readonly deps: LifecycleDependencies) {
    this.retained = readRetained(deps.storage);
  }

  subscribe(listener: (state: DurabilityState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  private update(change: Partial<DurabilityState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }

  async startup() {
    const result = await this.deps.startup();
    this.update({
      ready: true,
      candidate: result.candidate,
      mode: result.storageAvailable ? 'persistent' : 'memory',
      warning: result.storageAvailable ? null : 'Browser storage is unavailable. This Work Session is kept only in this tab and will not survive reload.'
    });
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
    if (!this.state.ready || revision === this.lastRevision) return;
    this.lastRevision = revision;
    if (this.pendingSave !== null) this.deps.cancel(this.pendingSave);
    this.pendingSave = null;

    if (this.retained && !this.retained.replacementId && session.id !== this.retained.predecessorId) {
      this.retained = { ...this.retained, replacementId: session.id };
      writeRetained(this.deps.storage, this.retained);
    }

    if (session.documents.length === 0) {
      if (session.id !== this.retained?.predecessorId) void this.deps.clear(session.id);
      return;
    }

    const snapshot = cloneSession(session);
    this.pendingSave = this.deps.schedule(() => {
      this.pendingSave = null;
      void this.persist(snapshot);
    }, 500);
  }

  private async persist(session: WorkSession) {
    try {
      const outcome = await this.deps.save(session);
      if (outcome === 'memory') {
        this.update({
          mode: 'memory',
          warning: this.state.warning ?? 'Autosave is using memory only. Changes will not survive reload.'
        });
        return;
      }
      this.update({ mode: 'persistent' });
      if (this.retained?.replacementId === session.id && this.retained.predecessorId !== session.id) {
        await this.deps.clear(this.retained.predecessorId);
        this.retained = null;
        writeRetained(this.deps.storage, null);
      }
    } catch {
      this.update({
        warning: this.state.warning ?? 'Autosave failed. Your latest changes may not survive reload.'
      });
    }
  }

  dispose() {
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
    cancel: (handle) => window.clearTimeout(handle)
  });
}
