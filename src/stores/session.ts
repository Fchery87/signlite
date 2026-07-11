import { create } from 'zustand';
import type { Placement, SessionDocument, SignatureAsset, WorkSession } from '../db/schema';
import { addSignaturePlacement as editorAddSignaturePlacement } from '../lib/workSessionEditor';
import { STRINGS } from '../lib/strings';

export type ViewState = 'dropzone' | 'editor';

export type ApplyTemplatePlacementsResult = {
  appliedDocIds: string[];
  needsReviewDocIds: string[];
};

type HistoryEntry = {
  documents: SessionDocument[];
  templatePlacements: Placement[];
  coalesceKey?: string;
  at: number;
};

type History = { past: HistoryEntry[]; future: HistoryEntry[] };

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
  updatePlacement: (docId: string, placementId: string, next: Partial<Placement>) => void;
  removePlacement: (docId: string, placementId: string) => void;
  duplicatePlacement: (docId: string, placementId: string) => void;
  copyPlacement: (docId: string, placementId: string) => void;
  pastePlacement: (docId: string, pageIndex: number) => Placement | null;
  pushHistory: (coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  updateDocumentStatus: (docId: string, status: SessionDocument['status']) => void;
  setDocumentBatchError: (docId: string, message: string | null) => void;
  applyTemplatePlacements: () => ApplyTemplatePlacementsResult;
  setSelection: (docId: string | null, placementId: string | null) => void;
  replaceSession: (session: WorkSession) => void;
  resetSession: () => void;
};

const HISTORY_LIMIT = 50;
const COALESCE_WINDOW_MS = 1000;

const emptyHistory = (): History => ({ past: [], future: [] });

/** Snapshots share document/placement references, so entries are cheap. */
function pushHistoryEntry(state: SessionState, coalesceKey?: string): History {
  const previous = state.history.past[state.history.past.length - 1];
  if (coalesceKey && previous?.coalesceKey === coalesceKey && Date.now() - previous.at < COALESCE_WINDOW_MS) {
    return state.history;
  }

  const entry: HistoryEntry = {
    documents: state.session.documents,
    templatePlacements: state.session.templatePlacements,
    coalesceKey,
    at: Date.now()
  };
  return {
    past: [...state.history.past.slice(-(HISTORY_LIMIT - 1)), entry],
    future: []
  };
}

function placementExists(documents: SessionDocument[], placementId: string | null) {
  return placementId !== null && documents.some((doc) => doc.placements.some((placement) => placement.id === placementId));
}

function restoreHistoryEntry(state: SessionState, entry: HistoryEntry): Partial<SessionState> {
  const documents = entry.documents;
  return {
    session: {
      ...state.session,
      updatedAt: Date.now(),
      documents,
      templatePlacements: entry.templatePlacements
    },
    selectedDocumentId:
      state.selectedDocumentId && documents.some((doc) => doc.docId === state.selectedDocumentId)
        ? state.selectedDocumentId
        : documents[0]?.docId ?? null,
    selectedPlacementId: placementExists(documents, state.selectedPlacementId) ? state.selectedPlacementId : null
  };
}

function syncTemplatePlacements(documents: SessionDocument[]) {
  return documents[0]?.placements.map((placement) => ({ ...placement })) ?? [];
}

function clonePlacement(placement: Placement): Placement {
  return {
    ...placement,
    id: crypto.randomUUID()
  };
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
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        selectedDocumentId: state.selectedDocumentId ?? docs[0]?.docId ?? null,
        history: emptyHistory(),
        copiedPlacement: null,
        view: documents.length > 0 ? 'editor' : 'dropzone'
      };
    }),
  removeDocument: (docId) =>
    set((state) => {
      const documents = state.session.documents.filter((doc) => doc.docId !== docId);
      const nextSelectedDocumentId =
        state.selectedDocumentId && documents.some((doc) => doc.docId === state.selectedDocumentId)
          ? state.selectedDocumentId
          : documents[0]?.docId ?? null;

      return {
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        selectedDocumentId: nextSelectedDocumentId,
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
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        history: emptyHistory()
      };
    }),
  addPlacement: (docId, placement) =>
    set((state) => {
      const documents: SessionDocument[] = state.session.documents.map((doc) =>
        doc.docId === docId ? { ...doc, placements: [...doc.placements, placement], status: 'placed', batchError: undefined } : doc
      );

      return {
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        selectedDocumentId: docId,
        selectedPlacementId: placement.id,
        history: pushHistoryEntry(state),
        view: 'editor'
      };
    }),
  addSignaturePlacement: async (docId, asset, placement) => {
    const state = get();
    const result = await editorAddSignaturePlacement(
      state.session,
      state.history,
      { docId, asset, placement }
    );
    if (!result.ok) return null;

    set({
      session: result.session,
      history: result.history,
      selectedDocumentId: docId,
      selectedPlacementId: result.placement.id,
      view: 'editor'
    });
    return result.placement;
  },
  updatePlacement: (docId, placementId, next) =>
    set((state) => {
      const documents: SessionDocument[] = state.session.documents.map((doc) =>
        doc.docId === docId
          ? {
              ...doc,
              placements: doc.placements.map((placement) => (placement.id === placementId ? { ...placement, ...next } : placement))
            }
          : doc
      );

      return {
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        }
      };
    }),
  removePlacement: (docId, placementId) =>
    set((state) => {
      const documents: SessionDocument[] = state.session.documents.map((doc) => {
        if (doc.docId !== docId) {
          return doc;
        }

        const placements = doc.placements.filter((placement) => placement.id !== placementId);
        return {
          ...doc,
          placements,
          status: placements.length > 0 ? doc.status : 'pending'
        };
      });

      return {
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        selectedPlacementId: state.selectedPlacementId === placementId ? null : state.selectedPlacementId,
        history: pushHistoryEntry(state)
      };
    }),
  duplicatePlacement: (docId, placementId) =>
    set((state) => {
      const doc = state.session.documents.find((item) => item.docId === docId);
      const source = doc?.placements.find((placement) => placement.id === placementId);
      if (!doc || !source) return state;

      const clone: Placement = {
        ...clonePlacement(source),
        x: Math.min(source.x + 0.02, 1 - source.w),
        y: Math.min(source.y + 0.02, 1 - source.h)
      };
      const documents: SessionDocument[] = state.session.documents.map((item) =>
        item.docId === docId ? { ...item, placements: [...item.placements, clone], status: 'placed', batchError: undefined } : item
      );

      return {
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        selectedDocumentId: docId,
        selectedPlacementId: clone.id,
        history: pushHistoryEntry(state)
      };
    }),
  copyPlacement: (docId, placementId) =>
    set((state) => {
      const doc = state.session.documents.find((item) => item.docId === docId);
      const source = doc?.placements.find((placement) => placement.id === placementId);
      if (!source) return state;
      return { copiedPlacement: { ...source } };
    }),
  pastePlacement: (docId, pageIndex) => {
    const state = get();
    const doc = state.session.documents.find((item) => item.docId === docId);
    if (!state.copiedPlacement || !doc || pageIndex < 0 || pageIndex >= doc.pageCount) {
      return null;
    }

    const clone: Placement = { ...clonePlacement(state.copiedPlacement), pageIndex };
    set((current) => {
      const documents: SessionDocument[] = current.session.documents.map((item) =>
        item.docId === docId ? { ...item, placements: [...item.placements, clone], status: 'placed', batchError: undefined } : item
      );

      return {
        session: {
          ...current.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        selectedDocumentId: docId,
        selectedPlacementId: clone.id,
        history: pushHistoryEntry(current)
      };
    });
    return clone;
  },
  pushHistory: (coalesceKey) => set((state) => ({ history: pushHistoryEntry(state, coalesceKey) })),
  undo: () =>
    set((state) => {
      const entry = state.history.past[state.history.past.length - 1];
      if (!entry) return state;

      const current: HistoryEntry = {
        documents: state.session.documents,
        templatePlacements: state.session.templatePlacements,
        at: Date.now()
      };
      return {
        ...restoreHistoryEntry(state, entry),
        history: { past: state.history.past.slice(0, -1), future: [...state.history.future, current] }
      };
    }),
  redo: () =>
    set((state) => {
      const entry = state.history.future[state.history.future.length - 1];
      if (!entry) return state;

      const current: HistoryEntry = {
        documents: state.session.documents,
        templatePlacements: state.session.templatePlacements,
        at: Date.now()
      };
      return {
        ...restoreHistoryEntry(state, entry),
        history: { past: [...state.history.past, current], future: state.history.future.slice(0, -1) }
      };
    }),
  updateDocumentStatus: (docId, status) =>
    set((state) => ({
      session: {
        ...state.session,
        updatedAt: Date.now(),
        documents: state.session.documents.map((doc) =>
          doc.docId === docId
            ? {
                ...doc,
                status,
                batchError: status === 'error' || status === 'needs-review' ? doc.batchError : undefined
              }
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
          doc.docId === docId
            ? {
                ...doc,
                batchError: message ?? undefined
              }
            : doc
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
        session: {
          ...state.session,
          updatedAt: Date.now(),
          documents,
          templatePlacements: syncTemplatePlacements(documents)
        },
        history: pushHistoryEntry(state)
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
