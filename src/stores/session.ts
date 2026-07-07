import { create } from 'zustand';
import type { Placement, SessionDocument, WorkSession } from '../db/schema';
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
  view: ViewState;
  addDocuments: (docs: SessionDocument[]) => void;
  removeDocument: (docId: string) => void;
  reorderDocuments: (docIds: string[]) => void;
  addPlacement: (docId: string, placement: Placement) => void;
  updatePlacement: (docId: string, placementId: string, next: Partial<Placement>) => void;
  removePlacement: (docId: string, placementId: string) => void;
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
  templatePlacements: []
});

export const useSessionStore = create<SessionState>((set) => ({
  session: createInitialSession(),
  selectedDocumentId: null,
  selectedPlacementId: null,
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
        }
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
        view: 'editor'
      };
    }),
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
        selectedPlacementId: state.selectedPlacementId === placementId ? null : state.selectedPlacementId
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
        }
      };
    });

    return { appliedDocIds, needsReviewDocIds };
  },
  setSelection: (docId, placementId) => set({ selectedDocumentId: docId, selectedPlacementId: placementId }),
  replaceSession: (session) =>
    set({
      session: {
        ...session,
        templatePlacements: session.templatePlacements.length > 0 ? session.templatePlacements : syncTemplatePlacements(session.documents)
      },
      selectedDocumentId: session.documents[0]?.docId ?? null,
      selectedPlacementId: null,
      view: session.documents.length > 0 ? 'editor' : 'dropzone'
    }),
  resetSession: () =>
    set({
      session: createInitialSession(),
      selectedDocumentId: null,
      selectedPlacementId: null,
      view: 'dropzone'
    })
}));
