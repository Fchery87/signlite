import type { Placement, SessionDocument, SignatureSnapshotMap, WorkSession } from '../db/schema';
import { getAsset } from '../db/signatures';
import { createSignatureSnapshot } from './signatureSnapshots';
import { STRINGS } from './strings';

/** Reads intrinsic pixel dimensions from a PNG IHDR header (width at offset 16, height at 20). */
function readPngDimensions(bytes: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(bytes);
  if (view.byteLength < 24) return { width: 0, height: 0 };
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function isSignaturePlacement(placement: Placement): placement is Placement & { type: 'signature' | 'initials' } {
  return placement.type === 'signature' || placement.type === 'initials';
}

/**
 * Normalizes a legacy Work Session into the immutable snapshot representation.
 *
 * - Legacy placements with embedded bytes are interned into the snapshot pool.
 * - Legacy placements without bytes are recovered from the Signature Library when available.
 * - Unrecoverable placements keep their document in Needs Review with a visible reason.
 * - Transient signed/signing state is cleared so it is not restored as durable truth.
 * - Idempotent: an already-normalized session passes through unchanged.
 */
export async function normalizeSession(session: WorkSession): Promise<WorkSession> {
  const snapshots: SignatureSnapshotMap = { ...(session.signatureSnapshots ?? {}) };
  const documents: SessionDocument[] = [];

  for (const doc of session.documents) {
    const normalizedPlacements: Placement[] = [];
    let unrecoverable = false;

    for (const placement of doc.placements) {
      if (!isSignaturePlacement(placement)) {
        normalizedPlacements.push(placement);
        continue;
      }

      // Already normalized — snapshot exists in the pool
      if (placement.snapshotId && snapshots[placement.snapshotId]) {
        normalizedPlacements.push(placement);
        continue;
      }

      // Try to recover from embedded bytes
      if (placement.assetPngBytes) {
        const { width, height } = readPngDimensions(placement.assetPngBytes);
        const snapshot = await createSignatureSnapshot({
          kind: placement.type,
          pngBytes: placement.assetPngBytes,
          width,
          height
        });
        if (!snapshots[snapshot.id]) {
          snapshots[snapshot.id] = snapshot;
        }
        normalizedPlacements.push({
          ...placement,
          snapshotId: snapshot.id,
          assetId: undefined,
          assetPngBytes: undefined
        });
        continue;
      }

      // Try to recover from the Signature Library
      if (placement.assetId) {
        const asset = await getAsset(placement.assetId);
        if (asset?.pngBytes) {
          const snapshot = await createSignatureSnapshot({
            kind: asset.kind,
            pngBytes: asset.pngBytes,
            width: asset.width,
            height: asset.height
          });
          if (!snapshots[snapshot.id]) {
            snapshots[snapshot.id] = snapshot;
          }
          normalizedPlacements.push({
            ...placement,
            snapshotId: snapshot.id,
            assetId: undefined,
            assetPngBytes: undefined
          });
          continue;
        }
      }

      // Unrecoverable — keep the placement, flag the document
      unrecoverable = true;
      normalizedPlacements.push(placement);
    }

    // Clear transient signing-like state; do not restore as durable Signed truth
    let status = doc.status;
    let batchError = doc.batchError;
    if (status === 'signed' || status === 'signing') {
      status = normalizedPlacements.some(isSignaturePlacement) ? 'placed' : 'pending';
      batchError = undefined;
    }
    if (unrecoverable) {
      status = 'needs-review';
      batchError = STRINGS.batch.needsReviewMissingSignature;
    }

    documents.push({ ...doc, placements: normalizedPlacements, status, batchError });
  }

  // Repair template-derived state from the first document
  const templatePlacements = documents[0]?.placements.map((p) => ({ ...p })) ?? [];

  return {
    ...session,
    documents,
    templatePlacements,
    signatureSnapshots: snapshots,
    updatedAt: Date.now()
  };
}
