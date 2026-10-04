import type { Placement, SessionDocument, SignatureSnapshotMap, WorkSession } from '../db/schema';
import { getAsset } from '../db/signatures';
import { loadDocument, capturePageGeometry } from '../pdf/render';
import type { PageGeometry } from '../pdf/coords';
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
 * Recomputes page geometry from the immutable source bytes for sessions stored
 * before geometry was captured. The stored document bytes are never mutated:
 * pdf.js receives a slice copy. Returns undefined when the source cannot be read.
 */
async function reconstructPageGeometry(pdfBytes: ArrayBuffer, expectedCount: number): Promise<PageGeometry[] | undefined> {
  try {
    const pdf = await loadDocument(pdfBytes.slice(0));
    try {
      const geometries = await capturePageGeometry(pdf);
      if (geometries.length !== expectedCount) return undefined;
      return geometries;
    } finally {
      pdf.destroy();
    }
  } catch {
    return undefined;
  }
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

    // Signed is durable; only the transient in-flight state is cleared.
    // Legacy needs-review status is migrated to orthogonal review state.
    let status = doc.status;
    let batchError = doc.batchError;
    let needsReviewReason = doc.needsReviewReason;
    if (status === 'signing') {
      status = normalizedPlacements.length > 0 ? 'placed' : 'pending';
      batchError = undefined;
    }
    if (status === 'needs-review') {
      status = normalizedPlacements.length > 0 ? 'placed' : 'pending';
      needsReviewReason = needsReviewReason ?? batchError ?? STRINGS.batch.needsReviewMissingSignature;
      batchError = undefined;
    }
    if (unrecoverable) {
      needsReviewReason = STRINGS.batch.needsReviewMissingSignature;
    }

    // Legacy sessions predate stored page geometry; reconstruct it from the
    // source bytes so exports honor rotation, CropBox origin, and UserUnit.
    let pageGeometry = doc.pageGeometry;
    if (!pageGeometry || pageGeometry.length !== doc.pageCount) {
      const reconstructed = await reconstructPageGeometry(doc.pdfBytes, doc.pageCount);
      if (reconstructed) {
        pageGeometry = reconstructed;
      } else if (doc.placements.length > 0 && !needsReviewReason) {
        // Placements on this document cannot be exported faithfully without
        // geometry; surface the gap instead of silently degrading the output.
        needsReviewReason = STRINGS.batch.needsReviewPageGeometry;
      }
    }

    documents.push({ ...doc, placements: normalizedPlacements, status, batchError, needsReviewReason, pageGeometry });
  }

  // Repair template-derived state from the first document
  const templatePlacements = documents[0]?.placements.map((p) => ({ ...p })) ?? [];

  return {
    ...session,
    documents,
    templatePlacements,
    signatureSnapshots: snapshots
  };
}
