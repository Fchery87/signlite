import { create } from 'zustand';
import type { Placement, SessionDocument, SignatureAsset, WorkSession } from '../db/schema';
import {
  addSignaturePlacement as editorAddSignaturePlacement,
  addTextPlacement as editorAddTextPlacement,
  updatePlacement as editorUpdatePlacement,
  removePlacement as editorRemovePlacement,
  duplicatePlacement as editorDuplicatePlacement,
  copyPlacement as editorCopyPlacement,
  pastePlacement as editorPastePlacement,
  undo as editorUndo,
  redo as editorRedo,
  emptyHistory,
  type History,
  type PlacementChanges
} from '../lib/workSessionEditor';
import { STRINGS } from '../lib/strings';

export type ViewState = 'dropzone' | 'editor';

export type ApplyTemplatePlacementsResult = {
  appliedDocIds: string[];
  needsReviewDocIds: string[];
};

type SessionState = {
  session: WorkSession;
  selectedDocumentId: string | null;
  selectedPlacementId: string | null;
  copiedPlacement: Placement | null;
  history: History;
  view: ViewState;
  addDocuments: (docs: SessionDocument[]) => void;
  removeDocument: (docId: string) => void;
  reorderDocuments: (docIds: string[]) => void;
  addPlacement: (docId: string, placement: Placement) => void;
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
  updateDocumentStatus: (docId: string, status: SessionDocument['status']) => void;
  setDocumentBatchError: (docId: string, message: string | null) => void;
  applyTemplatePlacements: () => ApplyTemplatePlacementsResult;
  setSelection: (docId: string | null, placementId: string | null) => void;
  replaceSession: (session: WorkSession) => void;
  resetSession: () => void;
};

function syncTemplatePlacements(documents: SessionDocument[]) {
  return documents[0]?.placements.map((placement) => ({ ...placement })) ?? [];
}

function clonePlacement(placement: Placement): Placement {
  return { ...placement, id: crypto.randomUUID() };
}

function getTemplateMismatchMessage(templateDocument: SessionDocument, targetDocument: SessionDocument, templatePlacements: Placement[]) {
  const missingPage = templatePlacements.some((placement) => placement.pageIndex >= targetDocument.pageCount);
  if (missingPage) {
    return STRINGS.batch.needsReviewMissingPage;
  }

  const hasAspectMismatch = templatePlacements.some((placement) => {
    const templatePage = templateDocument.pageSizes[placement.pageIndex];
    const targetPage = targetDocument.pageSizes[placement.pageIndex];
    if (!templatePage || !targetPage) {
      return true;
    }

    const templateAspect = templatePage.w / Math.max(templatePage.h, 1);
    const targetAspect = targetPage.w / Math.max(targetPage.h, 1);
    return Math.abs(targetAspect - templateAspect) / templateAspect > 0.1;
  });

  return hasAspectMismatch ? STRINGS.batch.needsReviewAspect : null;
}

function repairSelectedDocument(documents: SessionDocument[], selectedDocumentId: string | null): string | null {
  return selectedDocumentId && documents.some((doc) => doc.docId === selectedDocumentId)
    ? selectedDocumentId
    : documents[0]?.docId ?? null;
}

export const createInitialSession = (): WorkSession => ({
  id: crypto.randomUUID(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  documents: [],
  templatePlacements: [],
  signatureSnapshots: {}
});

export const useSessionStore = create<SessionState>((set, get) => ({
  session: createInitialSession(),
  selectedDocumentId: null,
  selectedPlacementId: null,
  copiedPlacement: null,
  history: emptyHistory(),
  view: 'dropzone',

  addDocuments: (docs) =>
    set((state) => {
      const documents = [...state.session.documents, ...docs];
      return {
        session: { ...state.session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
        selectedDocumentId: state.selectedDocumentId ?? docs[0]?.docId ?? null,
        history: emptyHistory(),
        copiedPlacement: null,
        view: documents.length > 0 ? 'editor' : 'dropzone'
      };
    }),

  removeDocument: (docId) =>
    set((state) => {
      const documents = state.session.documents.filter((doc) => doc.docId !== docId);
      return {
        session: { ...state.session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
        selectedDocumentId: repairSelectedDocument(documents, state.selectedDocumentId),
        selectedPlacementId: null,
        history: emptyHistory(),
        copiedPlacement: null,
        view: documents.length > 0 ? 'editor' : 'dropzone'
      };
    }),

  reorderDocuments: (docIds) =>
    set((state) => {
      const documents = docIds
        .map((docId) => state.session.documents.find((doc) => doc.docId === docId))
        .filter((doc): doc is SessionDocument => Boolean(doc));
      return {
        session: { ...state.session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
        history: emptyHistory()
      };
    }),

  addPlacement: (docId, placement) => {
    const result = editorAddTextPlacement(get().session, get().history, { docId, placement });
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId ?? null,
      view: 'editor'
    });
  },

  addSignaturePlacement: async (docId, asset, placement) => {
    // Snapshot hashing is asynchronous. Retry against the latest state if another
    // complete action commits while hashing so stale state can never be restored.
    while (true) {
      const state = get();
      const result = await editorAddSignaturePlacement(state.session, state.history, { docId, asset, placement });
      if (!result.ok) return null;
      if (get().session !== state.session || get().history !== state.history) continue;

      set({
        session: result.session,
        history: result.history,
        selectedDocumentId: docId,
        selectedPlacementId: result.selectedPlacementId ?? null,
        view: 'editor'
      });
      return result.placement;
    }
  },

  updatePlacement: (docId, placementId, next, coalesceKey, historyMode) => {
    const result = editorUpdatePlacement(get().session, get().history, { docId, placementId, changes: next, coalesceKey, historyMode });
    if (!result.ok) return;
    set({ session: result.session, history: result.history });
  },

  removePlacement: (docId, placementId) => {
    const state = get();
    const result = editorRemovePlacement(state.session, state.history, docId, placementId, state.selectedPlacementId);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedPlacementId: result.selectedPlacementId ?? null
    });
  },

  duplicatePlacement: (docId, placementId) => {
    const result = editorDuplicatePlacement(get().session, get().history, docId, placementId);
    if (!result.ok) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId ?? null
    });
  },

  copyPlacement: (docId, placementId) => {
    const copy = editorCopyPlacement(get().session, docId, placementId);
    if (copy) set({ copiedPlacement: copy });
  },

  pastePlacement: (docId, pageIndex) => {
    const state = get();
    const result = editorPastePlacement(state.session, state.history, docId, pageIndex, state.copiedPlacement);
    if (!result.ok) return null;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.selectedPlacementId ?? null
    });
    return result.session.documents
      .find((d) => d.docId === docId)
      ?.placements.find((p) => p.id === result.selectedPlacementId) ?? null;
  },

  undo: () => {
    const state = get();
    const result = editorUndo(state.session, state.history, state.selectedPlacementId);
    if (!result.changed) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: repairSelectedDocument(result.session.documents, state.selectedDocumentId),
      selectedPlacementId: result.selectedPlacementId
    });
  },

  redo: () => {
    const state = get();
    const result = editorRedo(state.session, state.history, state.selectedPlacementId);
    if (!result.changed) return;
    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: repairSelectedDocument(result.session.documents, state.selectedDocumentId),
      selectedPlacementId: result.selectedPlacementId
    });
  },

  updateDocumentStatus: (docId, status) =>
    set((state) => ({
      session: {
        ...state.session,
        updatedAt: Date.now(),
        documents: state.session.documents.map((doc) =>
          doc.docId === docId
            ? { ...doc, status, batchError: status === 'error' || status === 'needs-review' ? doc.batchError : undefined }
            : doc
        )
      }
    })),

  setDocumentBatchError: (docId, message) =>
    set((state) => ({
      session: {
        ...state.session,
        updatedAt: Date.now(),
        documents: state.session.documents.map((doc) =>
          doc.docId === docId ? { ...doc, batchError: message ?? undefined } : doc
        )
      }
    })),

  applyTemplatePlacements: () => {
    const appliedDocIds: string[] = [];
    const needsReviewDocIds: string[] = [];

    set((state) => {
      const [templateDocument, ...otherDocuments] = state.session.documents;
      if (!templateDocument || templateDocument.placements.length === 0) {
        return state;
      }

      const documents: SessionDocument[] = [
        templateDocument,
        ...otherDocuments.map((doc) => {
          if (doc.status === 'signed') {
            return doc;
          }
          const mismatchMessage = getTemplateMismatchMessage(templateDocument, doc, templateDocument.placements);
          if (mismatchMessage) {
            needsReviewDocIds.push(doc.docId);
            return { ...doc, status: 'needs-review' as const, batchError: mismatchMessage };
          }
          appliedDocIds.push(doc.docId);
          return {
            ...doc,
            placements: templateDocument.placements.map(clonePlacement),
            status: 'placed' as const,
            batchError: undefined
          };
        })
      ];

      return {
        session: { ...state.session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
        history: { past: [...state.history.past.slice(-49), { documents: state.session.documents, templatePlacements: state.session.templatePlacements, at: Date.now() }], future: [] }
      };
    });

    return { appliedDocIds, needsReviewDocIds };
  },

  setSelection: (docId, placementId) => set({ selectedDocumentId: docId, selectedPlacementId: placementId }),

  replaceSession: (session) =>
    set({
      session: {
        ...session,
        templatePlacements: session.templatePlacements.length > 0 ? session.templatePlacements : syncTemplatePlacements(session.documents),
        signatureSnapshots: session.signatureSnapshots ?? {}
      },
      selectedDocumentId: session.documents[0]?.docId ?? null,
      selectedPlacementId: null,
      history: emptyHistory(),
      copiedPlacement: null,
      view: session.documents.length > 0 ? 'editor' : 'dropzone'
    }),

  resetSession: () =>
    set({
      session: createInitialSession(),
      selectedDocumentId: null,
      selectedPlacementId: null,
      history: emptyHistory(),
      copiedPlacement: null,
      view: 'dropzone'
    })
}));
