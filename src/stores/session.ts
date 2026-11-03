import { create } from 'zustand';
import type { Placement, SessionDocument, SignatureAsset, WorkSession } from '../db/schema';
import {
  addDocuments as editorAddDocuments,
  removeDocument as editorRemoveDocument,
  reorderDocuments as editorReorderDocuments,
  replaceSession as editorReplaceSession,
  previewApplyToAll as editorPreviewApplyToAll,
  confirmApplyToAll as editorConfirmApplyToAll,
  stampPlacementOnEveryPage as editorStampPlacementOnEveryPage,
  addSignaturePlacement as editorAddSignaturePlacement,
  applySignatureToDocuments as editorApplySignatureToDocuments,
  previewSavedSignatureApply as editorPreviewSavedSignatureApply,
  addTextPlacement as editorAddTextPlacement,
  updatePlacement as editorUpdatePlacement,
  removePlacement as editorRemovePlacement,
  duplicatePlacement as editorDuplicatePlacement,
  copyPlacement as editorCopyPlacement,
  pastePlacement as editorPastePlacement,
  undo as editorUndo,
  redo as editorRedo,
  transitionDocumentOutput as editorTransitionDocumentOutput,
  confirmBatchSigned as editorConfirmBatchSigned,
  acquireMutationLease as editorAcquireMutationLease,
  releaseMutationLease as editorReleaseMutationLease,
  emptyHistory,
  type History,
  type PlacementChanges,
  type WorkSessionEditorState,
  type ApplyToAllPreview,
  type ApplySavedSignatureOptions,
  type ApplySavedSignaturePreview,
  type ApplySavedSignatureSkip,
  type MutationLease
} from '../lib/workSessionEditor';
import { normalizeSession } from '../lib/normalizeSession';
import { BatchSigning } from '../lib/batchSigning';
import type { BatchSigningPorts, ProcessFlattenOutcome } from '../lib/batchSigning';
import { getAsset, getDateFormat } from '../db/signatures';
import { type FlattenAssetMap } from '../pdf/assets';
import { batchZipFileName, downloadBlob } from '../lib/files';
import type { FlattenWorkerResponse } from '../workers/flatten.worker';

export type { ApplyToAllPreview };

export type ViewState = 'dropzone' | 'queue' | 'editor';

/** Outcome of committing an intake result. Non-'ok' values are surfaced to the user. */
export type IntakeCommitOutcome = 'ok' | 'lease' | 'read-only' | 'session-changed' | 'budget';

export type ApplyTemplatePlacementsResult = {
  ok: boolean;
  appliedDocIds: string[];
  needsReviewDocIds: string[];
  error?: 'stale-preview' | 'rejected';
};

export type ApplySavedSignatureOutcome = {
  ok: boolean;
  appliedDocIds: string[];
  skipped: ApplySavedSignatureSkip[];
  error?: 'rejected' | 'nothing-to-apply';
};

type SessionState = {
  session: WorkSession;
  selectedDocumentId: string | null;
  selectedPlacementId: string | null;
  copiedPlacement: Placement | null;
  history: History;
  view: ViewState;
  ownershipRevision: number;
  contentRevision: number;
  mutationLease: MutationLease | null;
  mutationLock: Readonly<{ owner: string }> | null;
  /** True while another tab holds this Work Session's editing lock. A read-only
   *  tab never saves, so every content mutation is refused rather than kept
   *  in memory only to vanish on reload. */
  readOnly: boolean;
  setReadOnly: (readOnly: boolean) => void;
  /** Transient: the saved signature armed for click placement in the editor. */
  armedSignature: SignatureAsset | null;
  addDocuments: (docs: SessionDocument[], expectedSessionId?: string) => IntakeCommitOutcome;
  removeDocument: (docId: string) => void;
  reorderDocuments: (docIds: string[]) => void;
  addTextPlacement: (docId: string, placement: Placement) => void;
  addSignaturePlacement: (
    docId: string,
    asset: Pick<SignatureAsset, 'kind' | 'pngBytes' | 'width' | 'height'>,
    placement: Omit<Placement, 'type' | 'snapshotId' | 'assetId' | 'assetPngBytes'>
  ) => Promise<Placement | null>;
  updatePlacement: (
    docId: string,
    placementId: string,
    next: PlacementChanges,
    coalesceKey?: string,
    historyMode?: 'burst' | 'gesture'
  ) => void;
  removePlacement: (docId: string, placementId: string) => void;
  duplicatePlacement: (docId: string, placementId: string) => void;
  copyPlacement: (docId: string, placementId: string) => void;
  pastePlacement: (docId: string, pageIndex: number) => Placement | null;
  undo: () => void;
  redo: () => void;
  transitionDocumentOutput: (docId: string, status: SessionDocument['status'], batchError?: string, capability?: MutationLease) => boolean;
  confirmBatchSigned: (docIds: string[], capability: MutationLease) => boolean;
  acquireMutationLease: (owner: string) => MutationLease | null;
  releaseMutationLease: (capability: MutationLease) => boolean;
  previewApplyTemplatePlacements: (sourceDocId: string) => ApplyToAllPreview | null;
  applyTemplatePlacements: (sourceDocId: string, preview: ApplyToAllPreview) => ApplyTemplatePlacementsResult;
  applySignatureToDocuments: (asset: SignatureAsset, docIds: string[], options?: ApplySavedSignatureOptions) => Promise<ApplySavedSignatureOutcome>;
  previewSavedSignatureApply: (docIds: string[], kind: SignatureAsset['kind'], options?: ApplySavedSignatureOptions) => ApplySavedSignaturePreview;
  stampPlacementOnEveryPage: (docId: string, placementId: string) => { ok: boolean; added: number };
  setSelection: (docId: string | null, placementId: string | null) => void;
  openDocument: (docId: string, armedSignature?: SignatureAsset | null) => void;
  openQueue: () => void;
  openDropzone: () => void;
  disarmSignature: () => void;
  restoreSession: (session: WorkSession) => Promise<boolean>;
  resetSession: () => void;
};

/** Content mutations are refused while a batch holds the lease or while another
 *  tab owns this Work Session. */
function editingBlocked(state: Pick<SessionState, 'mutationLease' | 'readOnly'>) {
  return state.mutationLease !== null || state.readOnly;
}

/** UI-facing twin of editingBlocked: true while edits would be refused. */
export const selectEditingBlocked = (state: Pick<SessionState, 'mutationLock' | 'readOnly'>) =>
  state.mutationLock !== null || state.readOnly;

function toEditorState(state: SessionState): WorkSessionEditorState {
  return {
    session: state.session,
    history: state.history,
    selectedDocumentId: state.selectedDocumentId,
    selectedPlacementId: state.selectedPlacementId,
    copiedPlacement: state.copiedPlacement
  };
}

export const createInitialSession = (): WorkSession => ({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  documents: [],
  templatePlacements: [],
  signatureSnapshots: {}
});

const internalUseSessionStore = create<SessionState>((set, get) => ({
  session: createInitialSession(),
  selectedDocumentId: null,
  selectedPlacementId: null,
  copiedPlacement: null,
  history: emptyHistory(),
  view: 'dropzone',
  ownershipRevision: 0,
  contentRevision: 0,
  mutationLease: null,
  mutationLock: null,
  readOnly: false,
  armedSignature: null,

  setReadOnly: (readOnly) => {
    if (get().readOnly !== readOnly) set({ readOnly });
  },

  addDocuments: (docs, expectedSessionId) => {
    if (get().mutationLease) return 'lease';
    if (get().readOnly) return 'read-only';
    if (expectedSessionId !== undefined && get().session.id !== expectedSessionId) return 'session-changed';
    const result = editorAddDocuments(toEditorState(get()), docs);
    if (!result.ok) {
      return result.error.reason === 'session-limit-exceeded' ? 'budget' : 'lease';
    }
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      copiedPlacement: result.copiedPlacement,
      view: result.session.documents.length === 0 ? 'dropzone' : get().view === 'editor' ? 'editor' : 'queue',
      ownershipRevision: get().ownershipRevision + 1,
      contentRevision: get().contentRevision + 1
    });
    return 'ok';
  },

  removeDocument: (docId) => {
    if (editingBlocked(get())) return;
    const result = editorRemoveDocument(toEditorState(get()), docId);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      copiedPlacement: result.copiedPlacement,
      view: result.session.documents.length === 0 ? 'dropzone' : get().view === 'editor' ? 'editor' : 'queue',
      ownershipRevision: get().ownershipRevision + 1,
      contentRevision: get().contentRevision + 1
    });
  },

  reorderDocuments: (docIds) => {
    if (editingBlocked(get())) return;
    const result = editorReorderDocuments(toEditorState(get()), docIds);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      copiedPlacement: result.copiedPlacement,
      contentRevision: get().contentRevision + 1
    });
  },

  addTextPlacement: (docId, placement) => {
    if (editingBlocked(get())) return;
    const result = editorAddTextPlacement(get().session, get().history, { docId, placement });
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId ?? null,
      view: 'editor',
      contentRevision: get().contentRevision + 1
    });
  },

  addSignaturePlacement: async (docId, asset, placement) => {
    if (editingBlocked(get())) return null;
    const ownershipRevision = get().ownershipRevision;
    // Snapshot hashing is asynchronous. Retry against the latest state if another
    // complete action commits while hashing so stale state can never be restored.
    while (true) {
      const state = get();
      if (state.ownershipRevision !== ownershipRevision || editingBlocked(state)) return null;
      const result = await editorAddSignaturePlacement(state.session, state.history, { docId, asset, placement });
      if (!result.ok) return null;
      if (get().ownershipRevision !== ownershipRevision || editingBlocked(get())) return null;
      if (get().session !== state.session || get().history !== state.history) continue;

      set({
        session: result.session,
        history: result.history,
        selectedDocumentId: docId,
        selectedPlacementId: result.selectedPlacementId ?? null,
        view: 'editor',
        contentRevision: get().contentRevision + 1
      });
      return result.placement;
    }
  },

  applySignatureToDocuments: async (asset, docIds, options) => {
    const rejected: ApplySavedSignatureOutcome = { ok: false, appliedDocIds: [], skipped: [], error: 'rejected' };
    if (editingBlocked(get())) return rejected;
    const ownershipRevision = get().ownershipRevision;
    // The snapshot hash is asynchronous. Re-read the session after it settles,
    // and never overwrite a mutation that landed in between.
    while (true) {
      const state = get();
      if (state.ownershipRevision !== ownershipRevision || editingBlocked(state)) return rejected;
      const result = await editorApplySignatureToDocuments(state.session, state.history, { asset, docIds, options });
      if (!result.ok) {
        return {
          ok: false,
          appliedDocIds: [],
          skipped: [],
          error: result.error.reason === 'nothing-to-apply' ? 'nothing-to-apply' : 'rejected'
        };
      }
      if (get().ownershipRevision !== ownershipRevision || editingBlocked(get())) return rejected;
      if (get().session !== state.session || get().history !== state.history) continue;

      set({
        session: result.session,
        history: result.history,
        selectedDocumentId: result.selectedDocumentId,
        selectedPlacementId: result.selectedPlacementId,
        contentRevision: state.contentRevision + 1
      });
      return {
        ok: true,
        appliedDocIds: result.appliedDocIds ?? [],
        skipped: result.skipped ?? []
      };
    }
  },

  previewSavedSignatureApply: (docIds, kind, options) =>
    editorPreviewSavedSignatureApply(get().session.documents, docIds, kind, options),

  updatePlacement: (docId, placementId, next, coalesceKey, historyMode) => {
    if (editingBlocked(get())) return;
    const result = editorUpdatePlacement(get().session, get().history, { docId, placementId, changes: next, coalesceKey, historyMode });
    if (!result.ok) return;
    set({ session: result.session, history: result.history, contentRevision: get().contentRevision + 1 });
  },

  removePlacement: (docId, placementId) => {
    if (editingBlocked(get())) return;
    const state = get();
    const result = editorRemovePlacement(state.session, state.history, docId, placementId, state.selectedPlacementId);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedPlacementId: result.selectedPlacementId ?? null,
      contentRevision: get().contentRevision + 1
    });
  },

  duplicatePlacement: (docId, placementId) => {
    if (editingBlocked(get())) return;
    const result = editorDuplicatePlacement(get().session, get().history, docId, placementId);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId ?? null,
      contentRevision: get().contentRevision + 1
    });
  },

  copyPlacement: (docId, placementId) => {
    const copy = editorCopyPlacement(get().session, docId, placementId);
    if (copy) set({ copiedPlacement: copy });
  },

  pastePlacement: (docId, pageIndex) => {
    if (editingBlocked(get())) return null;
    const state = get();
    const result = editorPastePlacement(state.session, state.history, docId, pageIndex, state.copiedPlacement);
    if (!result.ok) return null;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId ?? null,
      contentRevision: get().contentRevision + 1
    });
    return result.session.documents
      .find((d) => d.docId === docId)
      ?.placements.find((p) => p.id === result.selectedPlacementId) ?? null;
  },

  undo: () => {
    if (editingBlocked(get())) return;
    const state = get();
    const result = editorUndo(state.session, state.history, state.selectedPlacementId, state.selectedDocumentId);
    if (!result.changed) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      contentRevision: state.contentRevision + 1
    });
  },

  redo: () => {
    if (editingBlocked(get())) return;
    const state = get();
    const result = editorRedo(state.session, state.history, state.selectedPlacementId, state.selectedDocumentId);
    if (!result.changed) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      contentRevision: state.contentRevision + 1
    });
  },

  transitionDocumentOutput: (docId, status, batchError, capability) => {
    const state = get();
    if (state.mutationLease && state.mutationLease !== capability) return false;
    const result = editorTransitionDocumentOutput(toEditorState(state), { docId, status, batchError });
    if (!result.ok) return false;
    set({ session: result.session, history: result.history, selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId, copiedPlacement: result.copiedPlacement,
      contentRevision: state.contentRevision + 1 });
    return true;
  },

  confirmBatchSigned: (docIds, capability) => {
    const state = get();
    if (state.mutationLease && state.mutationLease !== capability) return false;
    const result = editorConfirmBatchSigned(toEditorState(state), { docIds });
    if (!result.ok) return false;
    set({ session: result.session, history: result.history, selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId, contentRevision: state.contentRevision + 1 });
    return true;
  },

  acquireMutationLease: (owner) => {
    const state = get();
    if (state.readOnly) return null;
    const lease = editorAcquireMutationLease(state.mutationLease, owner);
    if (!lease) return null;
    set({ mutationLease: lease, mutationLock: { owner: lease.owner }, ownershipRevision: state.ownershipRevision + 1 });
    return lease;
  },

  releaseMutationLease: (capability) => {
    if (!editorReleaseMutationLease(get().mutationLease, capability)) return false;
    set({ mutationLease: null, mutationLock: null });
    return true;
  },

  previewApplyTemplatePlacements: (sourceDocId) => editorPreviewApplyToAll(get().session, get().contentRevision, sourceDocId),

  applyTemplatePlacements: (sourceDocId, preview) => {
    if (editingBlocked(get())) return { ok: false, appliedDocIds: [], needsReviewDocIds: [], error: 'rejected' };
    const state = get();
    const result = editorConfirmApplyToAll(toEditorState(state), state.contentRevision, sourceDocId, preview);
    if (!result.ok) {
      return {
        ok: false,
        appliedDocIds: [],
        needsReviewDocIds: [],
        error: result.error.reason === 'stale-preview' ? 'stale-preview' : 'rejected'
      };
    }
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      copiedPlacement: result.copiedPlacement,
      contentRevision: state.contentRevision + 1
    });
    return {
      ok: true,
      appliedDocIds: result.appliedDocIds ?? [],
      needsReviewDocIds: result.needsReviewDocIds ?? []
    };
  },

  openDocument: (docId, armedSignature = null) => {
    if (!get().session.documents.some((document) => document.docId === docId)) return;
    set({ view: 'editor', selectedDocumentId: docId, selectedPlacementId: null, armedSignature });
  },

  openQueue: () => {
    if (get().session.documents.length === 0) return;
    set({ view: 'queue', selectedPlacementId: null, armedSignature: null });
  },

  openDropzone: () => set({ view: 'dropzone', armedSignature: null }),

  disarmSignature: () => set({ armedSignature: null }),


  stampPlacementOnEveryPage: (docId, placementId) => {
    if (editingBlocked(get())) return { ok: false, added: 0 };
    const state = get();
    const result = editorStampPlacementOnEveryPage(state.session, state.history, docId, placementId);
    if (!result.ok) return { ok: false, added: 0 };
    if (result.added === 0) return { ok: true, added: 0 };
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId,
      contentRevision: state.contentRevision + 1
    });
    return { ok: true, added: result.added };
  },

  setSelection: (docId, placementId) => set({ selectedDocumentId: docId, selectedPlacementId: placementId }),

  // Resume and Start Fresh switch session identity, which is how a read-only
  // tab gets a session of its own, so only a batch lease blocks them.
  restoreSession: async (candidate) => {
    if (get().mutationLease) return false;
    const ownershipRevision = get().ownershipRevision;
    const normalized = await normalizeSession(candidate);
    if (get().ownershipRevision !== ownershipRevision || get().mutationLease) return false;
    const result = editorReplaceSession(toEditorState(get()), normalized);
    if (!result.ok || get().ownershipRevision !== ownershipRevision || get().mutationLease) return false;
    set({
      session: result.session,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      history: result.history,
      copiedPlacement: result.copiedPlacement,
      view: result.session.documents.length > 0 ? 'queue' : 'dropzone',
      armedSignature: null,
      ownershipRevision: ownershipRevision + 1,
      contentRevision: get().contentRevision + 1
    });
    return true;
  },

  resetSession: () => {
    const state = get();
    if (state.mutationLease) return;
    const result = editorReplaceSession(toEditorState(state), createInitialSession());
    if (!result.ok) return;
    set({ session: result.session, selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId, history: result.history,
      copiedPlacement: result.copiedPlacement, view: 'dropzone', armedSignature: null,
      ownershipRevision: state.ownershipRevision + 1, contentRevision: state.contentRevision + 1 });
  }
}));

/** React read/command subscription. Lease capabilities and imperative Zustand setters are intentionally not exposed. */
export type PublicSessionState = Omit<SessionState, 'mutationLease' | 'acquireMutationLease' | 'releaseMutationLease'>;

const publicStateCache = new WeakMap<SessionState, PublicSessionState>();

function projectPublicState(state: SessionState): PublicSessionState {
  const cached = publicStateCache.get(state);
  if (cached) return cached;
  const { mutationLease, acquireMutationLease, releaseMutationLease, ...publicState } = state;
  // Selectors receive a stable runtime projection, not only a narrower TypeScript view.
  void mutationLease;
  void acquireMutationLease;
  void releaseMutationLease;
  publicStateCache.set(state, publicState);
  return publicState;
}

export function useSessionStore<T>(selector: (state: PublicSessionState) => T): T {
  return internalUseSessionStore((state) => selector(projectPublicState(state)));
}

/** Test-only harness; production modules must not import this capability. */
export const sessionStoreTestHarness = {
  getState: internalUseSessionStore.getState,
  setState: internalUseSessionStore.setState
};

// ─── BatchSigning production factory ─────────────────────────────────────────

/**
 * Creates a BatchSigning instance with production ports wired to the store
 * adapter, IndexedDB, and the flatten Worker.  The optional callbacks let
 * the UI observe progress and delivery-phase transitions.
 */
export function createBatchSigning(
  onProgress?: (done: number, total: number) => void,
  onStatus?: (status: string) => void
): BatchSigning {
  const store = internalUseSessionStore;

  const ports: BatchSigningPorts = {
    acquireLease: (owner) => store.getState().acquireMutationLease(owner),
    releaseLease: (cap) => store.getState().releaseMutationLease(cap),
    getDocuments: () => store.getState().session.documents,
    getSnapshots: () => store.getState().session.signatureSnapshots ?? {},
    getDateFormat: () => getDateFormat(),
    resolveAssets: async (assetIds) => {
      const assets: FlattenAssetMap = {};
      for (const id of assetIds) {
        const asset = await getAsset(id);
        if (asset) assets[id] = asset.pngBytes;
      }
      return assets;
    },
    transitionOutput: (docId, status, error, cap) =>
      store.getState().transitionDocumentOutput(docId, status, error, cap),
    processFlatten: async (request, transfers, handlers, isCancelled) => {
      onStatus?.('processing');
      performance.mark('signlite:batch-processing-start');
      // The runtime owner keeps one resident worker (started, handshake
      // included, during readiness); attempts reuse it instead of paying a
      // spawn per batch, and a crash is repaired from resident bytes.
      const { acquireFlattenWorker } = await import('../pdf/runtime');
      const worker = await acquireFlattenWorker();
      const jobId = crypto.randomUUID();

      return await new Promise<ProcessFlattenOutcome>((resolve) => {
        const previousHandler = worker.onmessage;
        const previousErrorHandler = worker.onerror;
        const finish = (outcome: ProcessFlattenOutcome) => {
          performance.mark('signlite:batch-processing-end');
          // Hand the shared worker back to whatever handler preceded this
          // attempt, now that no further messages for this job can matter.
          worker.onmessage = previousHandler;
          worker.onerror = previousErrorHandler;
          resolve(outcome);
        };
        worker.onmessage = (event: MessageEvent<FlattenWorkerResponse>) => {
          const msg = event.data;
          // The worker is shared; responses from any other attempt are noise.
          if (msg.jobId && msg.jobId !== jobId) return;
          if (isCancelled()) { finish({ kind: 'cancelled' }); return; }
          if (msg.kind === 'progress') {
            handlers.onProgress(msg.docId, msg.done, msg.total);
            onProgress?.(msg.done, msg.total);
          } else if (msg.kind === 'error') {
            if (msg.docId) {
              handlers.onError(msg.docId, msg.message);
            } else {
              finish({ kind: 'all-failed' });
            }
          } else if (msg.kind === 'done') {
            finish({ kind: 'success', output: msg.output, mime: msg.mime });
          }
        };
        worker.onerror = () => { if (!isCancelled()) finish({ kind: 'all-failed' }); };
        worker.postMessage({ ...request, jobId }, transfers);
      });
    },
    deliverArtifact: async (artifact) => {
      onStatus?.('delivering');
      try {
        const fileName = artifact.mime === 'application/zip'
          ? batchZipFileName()
          : 'signed.pdf';
        downloadBlob(new Blob([artifact.output], { type: artifact.mime }), fileName);
        return true;
      } catch {
        return false;
      }
    },
    confirmBatchSigned: (docIds, cap) =>
      store.getState().confirmBatchSigned([...docIds], cap)
  };

  return new BatchSigning(ports);
}
