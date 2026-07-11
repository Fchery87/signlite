import type { Placement, SessionDocument, WorkSession } from '../db/schema';
import { createSignatureSnapshot } from './signatureSnapshots';

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

function pushHistoryEntry(history: History, session: WorkSession, coalesceKey?: string): History {
  const previous = history.past[history.past.length - 1];
  if (coalesceKey && previous?.coalesceKey === coalesceKey && Date.now() - previous.at < COALESCE_WINDOW_MS) {
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

// ─── Errors ──────────────────────────────────────────────────────────

export type WorkSessionEditorError = {
  reason: 'document-not-found' | 'page-not-found' | 'invalid-geometry' | 'unsupported-dimensions';
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

// ─── Results ─────────────────────────────────────────────────────────

export type AddSignaturePlacementResult =
  | { ok: true; session: WorkSession; history: History; placement: Placement }
  | { ok: false; error: WorkSessionEditorError };

// ─── Helpers ─────────────────────────────────────────────────────────

function syncTemplatePlacements(documents: SessionDocument[]): Placement[] {
  return documents[0]?.placements.map((p) => ({ ...p })) ?? [];
}

function validatePlacementInput(session: WorkSession, request: AddSignaturePlacementRequest): WorkSessionEditorError | null {
  const doc = session.documents.find((d) => d.docId === request.docId);
  if (!doc) {
    return { reason: 'document-not-found', message: `Document ${request.docId} not found` };
  }

  if (request.placement.pageIndex < 0 || request.placement.pageIndex >= doc.pageCount) {
    return { reason: 'page-not-found', message: `Page index ${request.placement.pageIndex} not found in ${request.docId}` };
  }

  const { x, y, w, h } = request.placement;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.01 || y + h > 1.01) {
    return { reason: 'invalid-geometry', message: `Invalid normalized geometry: x=${x}, y=${y}, w=${w}, h=${h}` };
  }

  if (request.asset.width <= 0 || request.asset.height <= 0) {
    return { reason: 'unsupported-dimensions', message: `Unsupported asset dimensions: ${request.asset.width}x${request.asset.height}` };
  }

  return null;
}

// ─── Actions ─────────────────────────────────────────────────────────

/**
 * Creates a signature or initials Placement with full snapshot resolution,
 * validation, history, selection, and template consequences.
 *
 * Validation runs synchronously before any async work. If validation fails,
 * nothing changes. On success, a complete immutable snapshot is resolved and
 * the new state is returned for the store to commit atomically.
 */
export async function addSignaturePlacement(
  session: WorkSession,
  history: History,
  request: AddSignaturePlacementRequest
): Promise<AddSignaturePlacementResult> {
  const error = validatePlacementInput(session, request);
  if (error) {
    return { ok: false, error };
  }

  const snapshot = await createSignatureSnapshot(request.asset);

  const nextPlacement: Placement = {
    ...request.placement,
    type: request.asset.kind,
    snapshotId: snapshot.id
  };

  const documents: SessionDocument[] = session.documents.map((doc) =>
    doc.docId === request.docId
      ? { ...doc, placements: [...doc.placements, nextPlacement], status: 'placed', batchError: undefined }
      : doc
  );

  const nextSession: WorkSession = {
    ...session,
    updatedAt: Date.now(),
    documents,
    templatePlacements: syncTemplatePlacements(documents),
    signatureSnapshots: {
      ...(session.signatureSnapshots ?? {}),
      [snapshot.id]: session.signatureSnapshots?.[snapshot.id] ?? snapshot
    }
  };

  return {
    ok: true,
    session: nextSession,
    history: pushHistoryEntry(history, session),
    placement: nextPlacement
  };
}
