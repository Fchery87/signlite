import type { Placement, SessionDocument, WorkSession } from '../db/schema';
import { createSignatureSnapshot } from './signatureSnapshots';
import { STRINGS } from './strings';

// ─── History (owned by WorkSessionEditor) ────────────────────────────

export type HistoryEntry = {
  documents: SessionDocument[];
  templatePlacements: Placement[];
  coalesceKey?: string;
  at: number;
};

export type History = { past: HistoryEntry[]; future: HistoryEntry[] };

export const HISTORY_LIMIT = 50;
const COALESCE_WINDOW_MS = 1000;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

function pushHistoryEntry(
  history: History,
  session: WorkSession,
  coalesceKey?: string,
  historyMode: 'burst' | 'gesture' = 'burst'
): History {
  const previous = history.past[history.past.length - 1];
  const canCoalesce = history.future.length === 0 && coalesceKey && previous?.coalesceKey === coalesceKey;
  if (canCoalesce && (historyMode === 'gesture' || Date.now() - previous.at < COALESCE_WINDOW_MS)) {
    return history;
  }
  const entry: HistoryEntry = {
    documents: session.documents,
    templatePlacements: session.templatePlacements,
    coalesceKey,
    at: Date.now()
  };
  return {
    past: [...history.past.slice(-(HISTORY_LIMIT - 1)), entry],
    future: []
  };
}

function restoreHistoryEntry(session: WorkSession, entry: HistoryEntry): Partial<RestoredState> {
  const documents = entry.documents;
  return {
    session: {
      ...session,
      updatedAt: Date.now(),
      documents,
      templatePlacements: syncTemplatePlacements(documents)
    },
    selectedPlacementId: null
  };
}

// ─── Errors ──────────────────────────────────────────────────────────

export type WorkSessionEditorError = {
  reason:
    | 'document-not-found'
    | 'duplicate-document-id'
    | 'invalid-document-order'
    | 'page-not-found'
    | 'placement-not-found'
    | 'duplicate-placement-id'
    | 'invalid-geometry'
    | 'unsupported-dimensions'
    | 'unsupported-placement'
    | 'invalid-value'
    | 'missing-snapshot'
    | 'empty-clipboard'
    | 'nothing-to-apply'
    | 'stale-preview';
  message: string;
};

// ─── Input types ─────────────────────────────────────────────────────

export type SignatureAssetInput = {
  kind: 'signature' | 'initials';
  pngBytes: ArrayBuffer;
  width: number;
  height: number;
};

export type SignaturePlacementInput = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AddSignaturePlacementRequest = {
  docId: string;
  asset: SignatureAssetInput;
  placement: SignaturePlacementInput;
};

export type PlacementChanges = Partial<Pick<Placement, 'pageIndex' | 'x' | 'y' | 'w' | 'h' | 'value' | 'fontSize'>>;

export type UpdatePlacementRequest = {
  docId: string;
  placementId: string;
  changes: PlacementChanges;
  coalesceKey?: string;
  historyMode?: 'burst' | 'gesture';
};

export type AddTextPlacementRequest = {
  docId: string;
  placement: Placement;
};

// ─── Results ─────────────────────────────────────────────────────────

type RestoredState = {
  session: WorkSession;
  selectedPlacementId: string | null;
};

export type OkResult = {
  ok: true;
  session: WorkSession;
  history: History;
  selectedPlacementId?: string | null;
};

export type ErrResult = { ok: false; error: WorkSessionEditorError };

export type EditorResult = OkResult | ErrResult;
export type AddSignaturePlacementResult = (OkResult & { placement: Placement }) | ErrResult;

export type WorkSessionEditorState = {
  session: WorkSession;
  history: History;
  selectedDocumentId: string | null;
  selectedPlacementId: string | null;
  copiedPlacement: Placement | null;
};

export type CompleteStateResult = ({
  ok: true;
} & WorkSessionEditorState) | ErrResult;

// ─── Helpers ─────────────────────────────────────────────────────────

function syncTemplatePlacements(documents: SessionDocument[]): Placement[] {
  return documents[0]?.placements.map((p) => ({ ...p })) ?? [];
}

function clonePlacement(placement: Placement): Placement {
  return { ...placement, id: crypto.randomUUID() };
}

function isValidGeometry(p: { x: number; y: number; w: number; h: number }): boolean {
  return [p.x, p.y, p.w, p.h].every(Number.isFinite)
    && p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0
    && p.x + p.w <= 1.01 && p.y + p.h <= 1.01;
}

function validateTextValue(placement: Placement): WorkSessionEditorError | null {
  if ((placement.type === 'text' || placement.type === 'date')
      && placement.fontSize !== undefined
      && (!Number.isFinite(placement.fontSize) || placement.fontSize < 8 || placement.fontSize > 72)) {
    return { reason: 'invalid-value', message: `Font size ${placement.fontSize} is out of range` };
  }
  return null;
}

function validateRequiredSnapshot(session: WorkSession, placement: Placement): WorkSessionEditorError | null {
  if (placement.type !== 'signature' && placement.type !== 'initials') return null;
  if (!placement.snapshotId || !session.signatureSnapshots?.[placement.snapshotId]) {
    return { reason: 'missing-snapshot', message: `Placement ${placement.id} has no available snapshot` };
  }
  return null;
}

function findPlacement(session: WorkSession, docId: string, placementId: string): { doc: SessionDocument; placement: Placement } | null {
  const doc = session.documents.find((d) => d.docId === docId);
  if (!doc) return null;
  const placement = doc.placements.find((p) => p.id === placementId);
  if (!placement) return null;
  return { doc, placement };
}

function repairSelectionPair(
  documents: SessionDocument[],
  selectedDocumentId: string | null,
  selectedPlacementId: string | null
): { selectedDocumentId: string | null; selectedPlacementId: string | null } {
  const selectedDocument = documents.find((doc) => doc.docId === selectedDocumentId) ?? documents[0];
  const placementIsInSelectedDocument = selectedDocument?.placements.some((placement) => placement.id === selectedPlacementId) ?? false;
  return {
    selectedDocumentId: selectedDocument?.docId ?? null,
    selectedPlacementId: placementIsInSelectedDocument ? selectedPlacementId : null
  };
}

function completeState(
  session: WorkSession,
  history: History,
  selectedDocumentId: string | null,
  selectedPlacementId: string | null,
  copiedPlacement: Placement | null
): CompleteStateResult {
  const selection = repairSelectionPair(session.documents, selectedDocumentId, selectedPlacementId);
  return { ok: true, session, history, copiedPlacement, ...selection };
}

function validateFreshPlacementId(session: WorkSession, placementId: string): WorkSessionEditorError | null {
  return session.documents.some((doc) => doc.placements.some((placement) => placement.id === placementId))
    ? { reason: 'duplicate-placement-id', message: `Placement ${placementId} already exists` }
    : null;
}

// ─── Validation ──────────────────────────────────────────────────────

function validateDocAndPage(session: WorkSession, docId: string, pageIndex: number): WorkSessionEditorError | null {
  const doc = session.documents.find((d) => d.docId === docId);
  if (!doc) return { reason: 'document-not-found', message: `Document ${docId} not found` };
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.pageCount) return { reason: 'page-not-found', message: `Page index ${pageIndex} out of range` };
  return null;
}

function validateAssetDimensions(width: number, height: number): WorkSessionEditorError | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { reason: 'unsupported-dimensions', message: `Unsupported dimensions: ${width}x${height}` };
  return null;
}

// ─── Complete document actions ───────────────────────────────────────

/** Adds document resources and establishes a membership history barrier. */
export function addDocuments(state: WorkSessionEditorState, addedDocuments: SessionDocument[]): CompleteStateResult {
  const existingIds = new Set(state.session.documents.map((doc) => doc.docId));
  const addedIds = addedDocuments.map((doc) => doc.docId);
  if (new Set(addedIds).size !== addedIds.length || addedIds.some((docId) => existingIds.has(docId))) {
    return { ok: false, error: { reason: 'duplicate-document-id', message: 'Document identities must be unique' } };
  }
  const documents = [...state.session.documents, ...addedDocuments];
  const session = {
    ...state.session,
    updatedAt: Date.now(),
    documents,
    templatePlacements: syncTemplatePlacements(documents)
  };
  return completeState(
    session,
    emptyHistory(),
    state.selectedDocumentId ?? addedDocuments[0]?.docId ?? null,
    state.selectedPlacementId,
    null
  );
}

/** Removes a document resource and establishes a membership history barrier. */
export function removeDocument(state: WorkSessionEditorState, docId: string): CompleteStateResult {
  if (!state.session.documents.some((doc) => doc.docId === docId)) {
    return { ok: false, error: { reason: 'document-not-found', message: `Document ${docId} not found` } };
  }
  const documents = state.session.documents.filter((doc) => doc.docId !== docId);
  const session = {
    ...state.session,
    updatedAt: Date.now(),
    documents,
    templatePlacements: syncTemplatePlacements(documents)
  };
  return completeState(session, emptyHistory(), state.selectedDocumentId, state.selectedPlacementId, null);
}

/** Reorders the exact current document cohort as one undoable action. */
export function reorderDocuments(state: WorkSessionEditorState, docIds: string[]): CompleteStateResult {
  const currentIds = state.session.documents.map((doc) => doc.docId);
  const requestedIds = new Set(docIds);
  if (docIds.length !== currentIds.length
      || requestedIds.size !== docIds.length
      || currentIds.some((docId) => !requestedIds.has(docId))) {
    return { ok: false, error: { reason: 'invalid-document-order', message: 'Document order must be an exact permutation' } };
  }
  const byId = new Map(state.session.documents.map((doc) => [doc.docId, doc]));
  const documents = docIds.map((docId) => byId.get(docId)!);
  const session = {
    ...state.session,
    updatedAt: Date.now(),
    documents,
    templatePlacements: syncTemplatePlacements(documents)
  };
  return completeState(
    session,
    pushHistoryEntry(state.history, state.session),
    state.selectedDocumentId,
    state.selectedPlacementId,
    state.copiedPlacement
  );
}

/** Replaces runtime ownership with one normalized Work Session transition. */
export function replaceSession(state: WorkSessionEditorState, replacement: WorkSession): CompleteStateResult {
  const session = {
    ...replacement,
    templatePlacements: syncTemplatePlacements(replacement.documents),
    signatureSnapshots: replacement.signatureSnapshots ?? {}
  };
  return completeState(session, emptyHistory(), null, null, null);
}

// ─── Actions ─────────────────────────────────────────────────────────

/**
 * Creates a signature or initials Placement with full snapshot resolution,
 * validation, history, selection, and template consequences.
 */
export async function addSignaturePlacement(
  session: WorkSession,
  history: History,
  request: AddSignaturePlacementRequest
): Promise<AddSignaturePlacementResult> {
  const error = validateDocAndPage(session, request.docId, request.placement.pageIndex)
    ?? validateAssetDimensions(request.asset.width, request.asset.height)
    ?? validateFreshPlacementId(session, request.placement.id)
    ?? (request.asset.pngBytes.byteLength === 0
      ? { reason: 'missing-snapshot' as const, message: 'Signature image bytes are required' }
      : null);
  if (error) return { ok: false, error };

  if (!isValidGeometry(request.placement)) {
    return { ok: false, error: { reason: 'invalid-geometry', message: `Invalid geometry: ${JSON.stringify(request.placement)}` } };
  }

  const snapshot = await createSignatureSnapshot(request.asset);

  const nextPlacement: Placement = { ...request.placement, type: request.asset.kind, snapshotId: snapshot.id };
  const documents = session.documents.map((doc) =>
    doc.docId === request.docId
      ? { ...doc, placements: [...doc.placements, nextPlacement], status: 'placed' as const, batchError: undefined }
      : doc
  );

  return {
    ok: true,
    session: {
      ...session,
      updatedAt: Date.now(),
      documents,
      templatePlacements: syncTemplatePlacements(documents),
      signatureSnapshots: { ...(session.signatureSnapshots ?? {}), [snapshot.id]: session.signatureSnapshots?.[snapshot.id] ?? snapshot }
    },
    history: pushHistoryEntry(history, session),
    selectedPlacementId: nextPlacement.id,
    placement: nextPlacement
  };
}

/**
 * Adds a text or date Placement with validation, history, and selection.
 */
export function addTextPlacement(session: WorkSession, history: History, request: AddTextPlacementRequest): EditorResult {
  if (request.placement.type !== 'text' && request.placement.type !== 'date') {
    return { ok: false, error: { reason: 'unsupported-placement', message: 'Only text and date Placements use this action' } };
  }
  const error = validateDocAndPage(session, request.docId, request.placement.pageIndex)
    ?? validateTextValue(request.placement)
    ?? validateFreshPlacementId(session, request.placement.id);
  if (error) return { ok: false, error };

  if (!isValidGeometry(request.placement)) {
    return { ok: false, error: { reason: 'invalid-geometry', message: `Invalid geometry: ${JSON.stringify(request.placement)}` } };
  }

  const documents = session.documents.map((doc) =>
    doc.docId === request.docId
      ? { ...doc, placements: [...doc.placements, request.placement], status: 'placed' as const, batchError: undefined }
      : doc
  );

  return {
    ok: true,
    session: {
      ...session,
      updatedAt: Date.now(),
      documents,
      templatePlacements: syncTemplatePlacements(documents)
    },
    history: pushHistoryEntry(history, session),
    selectedPlacementId: request.placement.id
  };
}

/**
 * Updates a Placement with validation. Uses coalesceKey for gesture/typing
 * coalescing so one logical action creates one undo entry.
 */
export function updatePlacement(session: WorkSession, history: History, request: UpdatePlacementRequest): EditorResult {
  const found = findPlacement(session, request.docId, request.placementId);
  if (!found) {
    return { ok: false, error: { reason: 'placement-not-found', message: `Placement ${request.placementId} not found` } };
  }

  const updated = { ...found.placement, ...request.changes };
  const validationError = validateDocAndPage(session, request.docId, updated.pageIndex)
    ?? validateTextValue(updated)
    ?? validateRequiredSnapshot(session, updated);
  if (validationError) return { ok: false, error: validationError };

  if ((request.changes.x !== undefined || request.changes.y !== undefined ||
       request.changes.w !== undefined || request.changes.h !== undefined) && !isValidGeometry(updated)) {
    return { ok: false, error: { reason: 'invalid-geometry', message: `Invalid committed geometry` } };
  }

  const documents = session.documents.map((doc) =>
    doc.docId === request.docId
      ? {
          ...doc,
          placements: doc.placements.map((p) => (p.id === request.placementId ? updated : p)),
          status: 'placed' as const,
          batchError: undefined
        }
      : doc
  );

  return {
    ok: true,
    session: { ...session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
    history: pushHistoryEntry(history, session, request.coalesceKey, request.historyMode)
  };
}

/**
 * Removes a Placement, repairs selection, and pushes history.
 */
export function removePlacement(
  session: WorkSession,
  history: History,
  docId: string,
  placementId: string,
  selectedPlacementId: string | null = null
): EditorResult {
  const found = findPlacement(session, docId, placementId);
  if (!found) return { ok: false, error: { reason: 'placement-not-found', message: `Placement ${placementId} not found` } };

  const documents = session.documents.map((doc) => {
    if (doc.docId !== docId) return doc;
    const placements = doc.placements.filter((p) => p.id !== placementId);
    return {
      ...doc,
      placements,
      status: (placements.length > 0 ? 'placed' : 'pending') as SessionDocument['status'],
      batchError: undefined
    };
  });

  return {
    ok: true,
    session: { ...session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
    history: pushHistoryEntry(history, session),
    selectedPlacementId: selectedPlacementId === placementId ? null : selectedPlacementId
  };
}

/**
 * Duplicates a Placement with a fresh ID, small offset, and preserved snapshotId.
 */
export function duplicatePlacement(session: WorkSession, history: History, docId: string, placementId: string): EditorResult {
  const found = findPlacement(session, docId, placementId);
  if (!found) return { ok: false, error: { reason: 'placement-not-found', message: `Placement ${placementId} not found` } };

  const source = found.placement;
  const snapshotError = validateRequiredSnapshot(session, source);
  if (snapshotError) return { ok: false, error: snapshotError };
  const clone = {
    ...clonePlacement(source),
    x: Math.min(source.x + 0.02, 1 - source.w),
    y: Math.min(source.y + 0.02, 1 - source.h)
  };

  const documents = session.documents.map((doc) =>
    doc.docId === docId
      ? { ...doc, placements: [...doc.placements, clone], status: 'placed' as const, batchError: undefined }
      : doc
  );

  return {
    ok: true,
    session: { ...session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
    history: pushHistoryEntry(history, session),
    selectedPlacementId: clone.id
  };
}

/**
 * Copies a Placement to the clipboard. Returns the copied placement or null.
 */
export function copyPlacement(session: WorkSession, docId: string, placementId: string): Placement | null {
  const found = findPlacement(session, docId, placementId);
  return found ? { ...found.placement } : null;
}

/**
 * Pastes the clipboard Placement onto a page with a fresh ID and preserved snapshotId.
 */
export function pastePlacement(session: WorkSession, history: History, docId: string, pageIndex: number, clipboard: Placement | null): EditorResult {
  if (!clipboard) return { ok: false, error: { reason: 'empty-clipboard', message: 'No placement on clipboard' } };

  const error = validateDocAndPage(session, docId, pageIndex)
    ?? validateRequiredSnapshot(session, clipboard);
  if (error) return { ok: false, error };

  const clone = { ...clonePlacement(clipboard), pageIndex };
  if (!isValidGeometry(clone)) {
    return { ok: false, error: { reason: 'invalid-geometry', message: 'Clipboard Placement has invalid geometry' } };
  }

  const documents = session.documents.map((doc) =>
    doc.docId === docId
      ? { ...doc, placements: [...doc.placements, clone], status: 'placed' as const, batchError: undefined }
      : doc
  );

  return {
    ok: true,
    session: { ...session, updatedAt: Date.now(), documents, templatePlacements: syncTemplatePlacements(documents) },
    history: pushHistoryEntry(history, session),
    selectedPlacementId: clone.id
  };
}

// ─── Revision-bound apply-to-all ─────────────────────────────────────

export type ApplyToAllTargetPreview = {
  docId: string;
  fileName: string;
  compatible: boolean;
  overwritesPlacements: boolean;
  endsSignedState: boolean;
  needsReviewReason?: string;
};

export type ApplyToAllPreview = {
  revision: number;
  templateDocumentId: string;
  targets: ApplyToAllTargetPreview[];
};

export type ApplyToAllResult = CompleteStateResult & {
  appliedDocIds?: string[];
  needsReviewDocIds?: string[];
};

function templateMismatchReason(
  templateDocument: SessionDocument,
  targetDocument: SessionDocument,
  templatePlacements: Placement[]
): string | undefined {
  if (templatePlacements.some((placement) => placement.pageIndex >= targetDocument.pageCount)) {
    return STRINGS.batch.needsReviewMissingPage;
  }
  const aspectMismatch = templatePlacements.some((placement) => {
    const templatePage = templateDocument.pageSizes[placement.pageIndex];
    const targetPage = targetDocument.pageSizes[placement.pageIndex];
    if (!templatePage || !targetPage) return true;
    const templateAspect = templatePage.w / Math.max(templatePage.h, 1);
    const targetAspect = targetPage.w / Math.max(targetPage.h, 1);
    return Math.abs(targetAspect - templateAspect) / templateAspect > 0.1;
  });
  return aspectMismatch ? STRINGS.batch.needsReviewAspect : undefined;
}

/** Derives a non-mutating preview bound to the caller's monotonic content revision. */
export function previewApplyToAll(session: WorkSession, revision: number): ApplyToAllPreview | null {
  const [templateDocument, ...targets] = session.documents;
  if (!templateDocument || templateDocument.placements.length === 0 || targets.length === 0) return null;

  return {
    revision,
    templateDocumentId: templateDocument.docId,
    targets: targets.map((document) => {
      const needsReviewReason = templateMismatchReason(templateDocument, document, templateDocument.placements);
      return {
        docId: document.docId,
        fileName: document.fileName,
        compatible: !needsReviewReason,
        overwritesPlacements: !needsReviewReason && document.placements.length > 0,
        endsSignedState: !needsReviewReason && document.status === 'signed',
        needsReviewReason
      };
    })
  };
}

/** Confirms exactly the previewed revision as one atomic editor transition. */
export function confirmApplyToAll(
  state: WorkSessionEditorState,
  currentRevision: number,
  preview: ApplyToAllPreview
): ApplyToAllResult {
  if (preview.revision !== currentRevision) {
    return { ok: false, error: { reason: 'stale-preview', message: 'The Work Session changed after this preview' } };
  }
  const [templateDocument] = state.session.documents;
  if (!templateDocument || templateDocument.docId !== preview.templateDocumentId || templateDocument.placements.length === 0) {
    return { ok: false, error: { reason: 'stale-preview', message: 'The template changed after this preview' } };
  }
  if (preview.targets.length !== state.session.documents.length - 1
      || preview.targets.some((target, index) => state.session.documents[index + 1]?.docId !== target.docId)) {
    return { ok: false, error: { reason: 'stale-preview', message: 'The target cohort changed after this preview' } };
  }
  const missingSnapshot = templateDocument.placements.find((placement) => validateRequiredSnapshot(state.session, placement));
  if (missingSnapshot) {
    return { ok: false, error: validateRequiredSnapshot(state.session, missingSnapshot)! };
  }

  const appliedDocIds: string[] = [];
  const needsReviewDocIds: string[] = [];
  const documents = state.session.documents.map((document, index) => {
    if (index === 0) return document;
    const target = preview.targets[index - 1]!;
    const currentReason = templateMismatchReason(templateDocument, document, templateDocument.placements);
    if (currentReason || target.needsReviewReason) {
      needsReviewDocIds.push(document.docId);
      return { ...document, needsReviewReason: currentReason ?? target.needsReviewReason };
    }
    appliedDocIds.push(document.docId);
    const placements = templateDocument.placements.map(clonePlacement);
    return {
      ...document,
      placements,
      status: (placements.length > 0 ? 'placed' : 'pending') as SessionDocument['status'],
      batchError: undefined,
      needsReviewReason: undefined
    };
  });
  const session = {
    ...state.session,
    updatedAt: Date.now(),
    documents,
    templatePlacements: syncTemplatePlacements(documents)
  };
  const complete = completeState(
    session,
    pushHistoryEntry(state.history, state.session),
    state.selectedDocumentId,
    state.selectedPlacementId,
    state.copiedPlacement
  );
  return { ...complete, appliedDocIds, needsReviewDocIds };
}

// ─── Undo / Redo ────────────────────────────────────────────────────

export type HistoryResult = {
  changed: boolean;
  session: WorkSession;
  history: History;
  selectedDocumentId: string | null;
  selectedPlacementId: string | null;
};

export function undo(
  session: WorkSession,
  history: History,
  selectedPlacementId: string | null = null,
  selectedDocumentId: string | null = null
): HistoryResult {
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    const selection = repairSelectionPair(session.documents, selectedDocumentId, selectedPlacementId);
    return { changed: false, session, history, ...selection };
  }

  const current: HistoryEntry = {
    documents: session.documents,
    templatePlacements: session.templatePlacements,
    at: Date.now()
  };
  const restored = restoreHistoryEntry(session, entry).session!;
  const selection = repairSelectionPair(restored.documents, selectedDocumentId, selectedPlacementId);
  return {
    changed: true,
    session: restored,
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
    ...selection
  };
}

export function redo(
  session: WorkSession,
  history: History,
  selectedPlacementId: string | null = null,
  selectedDocumentId: string | null = null
): HistoryResult {
  const entry = history.future[history.future.length - 1];
  if (!entry) {
    const selection = repairSelectionPair(session.documents, selectedDocumentId, selectedPlacementId);
    return { changed: false, session, history, ...selection };
  }

  const current: HistoryEntry = {
    documents: session.documents,
    templatePlacements: session.templatePlacements,
    at: Date.now()
  };
  const restored = restoreHistoryEntry(session, entry).session!;
  const selection = repairSelectionPair(restored.documents, selectedDocumentId, selectedPlacementId);
  return {
    changed: true,
    session: restored,
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
    ...selection
  };
}
