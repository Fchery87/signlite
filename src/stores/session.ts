import { create } from 'zustand';
import type { Placement, SessionDocument, SignatureAsset, WorkSession } from '../db/schema';
import {
  addDocuments as editorAddDocuments,
  removeDocument as editorRemoveDocument,
  reorderDocuments as editorReorderDocuments,
  replaceSession as editorReplaceSession,
  previewApplyToAll as editorPreviewApplyToAll,
  confirmApplyToAll as editorConfirmApplyToAll,
  addSignaturePlacement as editorAddSignaturePlacement,
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

export type ViewState = 'dropzone' | 'editor';

export type ApplyTemplatePlacementsResult = {
  ok: boolean;
  appliedDocIds: string[];
  needsReviewDocIds: string[];
  error?: 'stale-preview' | 'rejected';
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
  addDocuments: (docs: SessionDocument[]) => void;
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
  previewApplyTemplatePlacements: () => ApplyToAllPreview | null;
  applyTemplatePlacements: (preview: ApplyToAllPreview) => ApplyTemplatePlacementsResult;
  setSelection: (docId: string | null, placementId: string | null) => void;
  restoreSession: (session: WorkSession) => Promise<boolean>;
  resetSession: () => void;
};

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

  addDocuments: (docs) => {
    if (get().mutationLease) return;
    const result = editorAddDocuments(toEditorState(get()), docs);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      copiedPlacement: result.copiedPlacement,
      view: result.session.documents.length > 0 ? 'editor' : 'dropzone',
      ownershipRevision: get().ownershipRevision + 1,
      contentRevision: get().contentRevision + 1
    });
  },

  removeDocument: (docId) => {
    if (get().mutationLease) return;
    const result = editorRemoveDocument(toEditorState(get()), docId);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: result.selectedDocumentId,
      selectedPlacementId: result.selectedPlacementId,
      copiedPlacement: result.copiedPlacement,
      view: result.session.documents.length > 0 ? 'editor' : 'dropzone',
      ownershipRevision: get().ownershipRevision + 1,
      contentRevision: get().contentRevision + 1
    });
  },

  reorderDocuments: (docIds) => {
    if (get().mutationLease) return;
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
    if (get().mutationLease) return;
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
    if (get().mutationLease) return null;
    const ownershipRevision = get().ownershipRevision;
    // Snapshot hashing is asynchronous. Retry against the latest state if another
    // complete action commits while hashing so stale state can never be restored.
    while (true) {
      const state = get();
      if (state.ownershipRevision !== ownershipRevision || state.mutationLease) return null;
      const result = await editorAddSignaturePlacement(state.session, state.history, { docId, asset, placement });
      if (!result.ok) return null;
      if (get().ownershipRevision !== ownershipRevision || get().mutationLease) return null;
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

  updatePlacement: (docId, placementId, next, coalesceKey, historyMode) => {
    if (get().mutationLease) return;
    const result = editorUpdatePlacement(get().session, get().history, { docId, placementId, changes: next, coalesceKey, historyMode });
    if (!result.ok) return;
    set({ session: result.session, history: result.history, contentRevision: get().contentRevision + 1 });
  },

  removePlacement: (docId, placementId) => {
    if (get().mutationLease) return;
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
    if (get().mutationLease) return;
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
    if (get().mutationLease) return null;
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
    if (get().mutationLease) return;
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
    if (get().mutationLease) return;
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

  previewApplyTemplatePlacements: () => editorPreviewApplyToAll(get().session, get().contentRevision),

  applyTemplatePlacements: (preview) => {
    if (get().mutationLease) return { ok: false, appliedDocIds: [], needsReviewDocIds: [], error: 'rejected' };
    const state = get();
    const result = editorConfirmApplyToAll(toEditorState(state), state.contentRevision, preview);
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

  setSelection: (docId, placementId) => set({ selectedDocumentId: docId, selectedPlacementId: placementId }),

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
      view: result.session.documents.length > 0 ? 'editor' : 'dropzone',
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
      copiedPlacement: result.copiedPlacement, view: 'dropzone',
      ownershipRevision: state.ownershipRevision + 1, contentRevision: state.contentRevision + 1 });
  }
}));

/** React read/command subscription. Lease capabilities and imperative Zustand setters are intentionally not exposed. */
type PublicSessionState = Omit<SessionState, 'mutationLease' | 'acquireMutationLease' | 'releaseMutationLease'>;

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
      const worker = new Worker(
        new URL('../workers/flatten.worker.ts', import.meta.url),
        { type: 'module' }
      );
      try {
        return await new Promise<ProcessFlattenOutcome>((resolve) => {
          worker.onmessage = (event: MessageEvent<FlattenWorkerResponse>) => {
            const msg = event.data;
            if (isCancelled()) { resolve({ kind: 'cancelled' }); return; }
            if (msg.kind === 'progress') {
              handlers.onProgress(msg.docId, msg.done, msg.total);
              onProgress?.(msg.done, msg.total);
            } else if (msg.kind === 'error') {
              if (msg.docId) {
                handlers.onError(msg.docId, msg.message);
              } else {
                resolve({ kind: 'all-failed' });
              }
            } else if (msg.kind === 'done') {
              resolve({ kind: 'success', output: msg.output, mime: msg.mime });
            }
          };
          worker.onerror = () => { if (!isCancelled()) resolve({ kind: 'all-failed' }); };
          worker.postMessage(request, transfers);
        });
      } finally {
        worker.terminate();
      }
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
