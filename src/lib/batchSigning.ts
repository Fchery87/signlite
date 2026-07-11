import type { SessionDocument, SignatureSnapshotMap } from '../db/schema';
import { collectAssetIds, type FlattenAssetMap } from '../pdf/assets';
import type { FlattenWorkerRequest } from '../workers/flatten.worker';

/**
 * Structurally compatible with the store capability token.
 * BatchSigning defines its own type so it has no import dependency on WorkSessionEditor.
 */
export type BatchLeaseCapability = Readonly<{ id: string; owner: string }>;

export const BATCH_LEASE_OWNER = 'batch-signing';

// ─── Cohort derivation ──────────────────────────────────────────────────────

export type BatchExclusionReason =
  | 'no-placements'
  | 'needs-review'
  | 'missing-snapshot'
  | 'missing-asset';

export interface BatchCohortEntry {
  docId: string;
  fileName: string;
}

export interface BatchCohortExclusion {
  docId: string;
  fileName: string;
  reason: BatchExclusionReason;
}

export interface BatchCohort {
  eligible: BatchCohortEntry[];
  excluded: BatchCohortExclusion[];
}

/**
 * Derives the complete eligible cohort from the current Work Session documents.
 * Retry-safe: every call reads the latest document state, never filtering by
 * previous success, failure, or Signed status.  Eligible Signed Documents are
 * included.  Documents with Needs Review status, no placements, or a placement
 * that references a missing snapshot are excluded with observable reasons.
 */
export function deriveCohort(
  documents: readonly SessionDocument[],
  snapshots: SignatureSnapshotMap
): BatchCohort {
  const eligible: BatchCohortEntry[] = [];
  const excluded: BatchCohortExclusion[] = [];

  for (const doc of documents) {
    if (doc.status === 'needs-review' || doc.needsReviewReason) {
      excluded.push({ docId: doc.docId, fileName: doc.fileName, reason: 'needs-review' });
      continue;
    }
    if (doc.placements.length === 0) {
      excluded.push({ docId: doc.docId, fileName: doc.fileName, reason: 'no-placements' });
      continue;
    }
    const hasMissingSnapshot = doc.placements.some(
      (p) => p.snapshotId && !(p.snapshotId in snapshots)
    );
    if (hasMissingSnapshot) {
      excluded.push({ docId: doc.docId, fileName: doc.fileName, reason: 'missing-snapshot' });
      continue;
    }
    eligible.push({ docId: doc.docId, fileName: doc.fileName });
  }

  return { eligible, excluded };
}

// ─── Ports ──────────────────────────────────────────────────────────────────

export type DocumentStatus = SessionDocument['status'];

export type ProcessFlattenOutcome =
  | { kind: 'success'; output: ArrayBuffer; mime: 'application/pdf' | 'application/zip' }
  | { kind: 'all-failed' }
  | { kind: 'cancelled' };

export interface BatchSigningPorts {
  acquireLease: (owner: string) => BatchLeaseCapability | null;
  releaseLease: (capability: BatchLeaseCapability) => boolean;
  getDocuments: () => readonly SessionDocument[];
  getSnapshots: () => SignatureSnapshotMap;
  getDateFormat: () => string | undefined;
  resolveAssets: (assetIds: readonly string[]) => Promise<FlattenAssetMap>;
  transitionOutput: (
    docId: string,
    status: DocumentStatus,
    error: string | undefined,
    capability: BatchLeaseCapability
  ) => boolean;
  processFlatten: (
    request: FlattenWorkerRequest,
    transfers: Transferable[],
    handlers: {
      onProgress: (docId: string, done: number, total: number) => void;
      onError: (docId: string, message: string) => void;
    },
    isCancelled: () => boolean
  ) => Promise<ProcessFlattenOutcome>;
}

// ─── Attempt state ─────────────────────────────────────────────────────────

export type BatchAttemptStatus =
  | 'idle'
  | 'preparing'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface BatchAttemptProgress {
  status: BatchAttemptStatus;
  done: number;
  total: number;
  failures: Record<string, string>;
}

export interface BatchArtifact {
  output: ArrayBuffer;
  mime: 'application/pdf' | 'application/zip';
  successCount: number;
}

export interface BatchAttemptResult {
  ok: boolean;
  cancelled: boolean;
  noEligible: boolean;
  artifact: BatchArtifact | null;
  cohort: BatchCohort;
  successCount: number;
  failureCount: number;
}

// ─── BatchSigning module ───────────────────────────────────────────────────

/**
 * Owns a coherent Batch Signing attempt from lease acquisition through
 * full-cohort worker processing, cancellation, deterministic artifact
 * assembly, and terminal lease release.  All attempt identity, progress,
 * failures, worker handles, and intermediate output remain transient — the
 * module never persists them to durable Work Session state.
 */
export class BatchSigning {
  private readonly ports: BatchSigningPorts;
  private cancelled = false;
  private active = false;
  private progress: BatchAttemptProgress = { status: 'idle', done: 0, total: 0, failures: {} };
  private successCount = 0;

  constructor(ports: BatchSigningPorts) {
    this.ports = ports;
  }

  getProgress(): BatchAttemptProgress {
    return { ...this.progress, failures: { ...this.progress.failures } };
  }

  isActive(): boolean {
    return this.active;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Runs one complete Batch Signing attempt.
   * Acquires the lease, derives the full cohort, prepares input, processes
   * the cohort through the flatten worker, and releases the lease on every
   * terminal path (success, all-failure, cancellation, or no-eligible).
   */
  async attempt(): Promise<BatchAttemptResult> {
    if (this.active) {
      throw new Error('A batch attempt is already in progress.');
    }
    this.active = true;
    this.successCount = 0;
    this.progress = { status: 'preparing', done: 0, total: 0, failures: {} };

    // ── 1. Acquire the lease BEFORE deriving eligibility or copying input ──
    const lease = this.ports.acquireLease(BATCH_LEASE_OWNER);
    if (!lease) {
      this.active = false;
      this.progress = { status: 'idle', done: 0, total: 0, failures: {} };
      return {
        ok: false, cancelled: false, noEligible: false, artifact: null,
        cohort: { eligible: [], excluded: [] }, successCount: 0, failureCount: 0
      };
    }

    try {
      return await this.runAttempt(lease);
    } finally {
      // ── Always release the lease on every terminal path ──
      this.ports.releaseLease(lease);
      this.active = false;
      this.cancelled = false;
    }
  }

  private async runAttempt(lease: BatchLeaseCapability): Promise<BatchAttemptResult> {
    // ── 2. Derive the full cohort from current Work Session state ──
    const documents = this.ports.getDocuments();
    const snapshots = this.ports.getSnapshots();
    const cohort = deriveCohort(documents, snapshots);

    if (cohort.eligible.length === 0) {
      this.progress = { status: 'failed', done: 0, total: 0, failures: {} };
      return {
        ok: false, cancelled: false, noEligible: true, artifact: null,
        cohort, successCount: 0, failureCount: 0
      };
    }

    // ── 3. Cancellation checkpoint before preparation ──
    if (this.cancelled) {
      this.progress = { status: 'cancelled', done: 0, total: 0, failures: {} };
      return this.cancelledResult(cohort);
    }

    // ── 4. Prepare input: resolve assets and validate ──
    const eligibleDocs = documents.filter((d) =>
      cohort.eligible.some((e) => e.docId === d.docId)
    );

    const assetIds = collectAssetIds(eligibleDocs);
    const assets = await this.ports.resolveAssets(assetIds);

    // Validate legacy asset references
    const finalEligible: SessionDocument[] = [];
    const additionalExcluded: BatchCohortExclusion[] = [];
    for (const doc of eligibleDocs) {
      const missingAsset = doc.placements.find(
        (p) =>
          (p.type === 'signature' || p.type === 'initials') &&
          !p.snapshotId &&
          !p.assetPngBytes &&
          p.assetId &&
          !(p.assetId in assets)
      );
      if (missingAsset) {
        additionalExcluded.push({ docId: doc.docId, fileName: doc.fileName, reason: 'missing-asset' });
      } else {
        finalEligible.push(doc);
      }
    }

    const finalCohort: BatchCohort = {
      eligible: finalEligible.map((d) => ({ docId: d.docId, fileName: d.fileName })),
      excluded: [...cohort.excluded, ...additionalExcluded]
    };

    if (finalEligible.length === 0) {
      this.progress = { status: 'failed', done: 0, total: 0, failures: {} };
      return {
        ok: false, cancelled: false, noEligible: true, artifact: null,
        cohort: finalCohort, successCount: 0, failureCount: 0
      };
    }

    // ── 5. Cancellation checkpoint after preparation ──
    if (this.cancelled) {
      this.progress = { status: 'cancelled', done: 0, total: 0, failures: {} };
      return this.cancelledResult(finalCohort);
    }

    // ── 6. Transition eligible documents to 'signing' ──
    for (const doc of finalEligible) {
      this.ports.transitionOutput(doc.docId, 'signing', undefined, lease);
    }

    // ── 7. Build the worker request with cloned, detached buffers ──
    const snapshotsCopy: SignatureSnapshotMap = {};
    for (const [id, snapshot] of Object.entries(snapshots)) {
      snapshotsCopy[id] = { ...snapshot, pngBytes: snapshot.pngBytes.slice(0) };
    }

    const request: FlattenWorkerRequest = {
      kind: 'flatten',
      snapshots: snapshotsCopy,
      docs: finalEligible.map((doc) => ({
        ...doc,
        pdfBytes: doc.pdfBytes.slice(0),
        placements: doc.placements.map((p) => ({ ...p })),
        pageSizes: doc.pageSizes.map((ps) => ({ ...ps }))
      })),
      assets,
      zip: finalEligible.length > 1,
      dateFormat: this.ports.getDateFormat()
    };

    const transfers: Transferable[] = [
      ...request.docs.map((d) => d.pdfBytes),
      ...Object.values(assets),
      ...Object.values(snapshotsCopy).map((s) => s.pngBytes)
    ];

    // ── 8. Cancellation checkpoint before processing ──
    if (this.cancelled) {
      this.progress = { status: 'cancelled', done: 0, total: 0, failures: {} };
      return this.cancelledResult(finalCohort);
    }

    // ── 9. Process the full cohort through the flatten worker ──
    this.progress = { status: 'processing', done: 0, total: finalEligible.length, failures: {} };

    const outcome = await this.ports.processFlatten(
      request,
      transfers,
      {
        onProgress: (docId, done, total) => {
          if (this.cancelled) return;
          this.successCount += 1;
          this.ports.transitionOutput(docId, 'signed', undefined, lease);
          this.progress = { ...this.progress, done, total };
        },
        onError: (docId, message) => {
          if (this.cancelled) return;
          this.ports.transitionOutput(docId, 'error', message, lease);
          this.progress.failures[docId] = message;
        }
      },
      () => this.cancelled
    );

    // ── 10. Cancellation checkpoint after processing ──
    if (this.cancelled) {
      this.progress = { ...this.progress, status: 'cancelled' };
      return this.cancelledResult(finalCohort);
    }

    if (outcome.kind === 'cancelled') {
      this.progress = { ...this.progress, status: 'cancelled' };
      return this.cancelledResult(finalCohort);
    }

    if (outcome.kind === 'all-failed') {
      this.progress = { ...this.progress, status: 'failed' };
      return {
        ok: false, cancelled: false, noEligible: false, artifact: null,
        cohort: finalCohort,
        successCount: 0,
        failureCount: finalEligible.length
      };
    }

    // ── 11. Success — deliver the artifact ──
    this.progress = { ...this.progress, status: 'succeeded' };
    const failureCount = Object.keys(this.progress.failures).length;
    return {
      ok: true, cancelled: false, noEligible: false,
      artifact: {
        output: outcome.output,
        mime: outcome.mime,
        successCount: this.successCount
      },
      cohort: finalCohort,
      successCount: this.successCount,
      failureCount
    };
  }

  private cancelledResult(cohort: BatchCohort): BatchAttemptResult {
    return {
      ok: false, cancelled: true, noEligible: false, artifact: null,
      cohort, successCount: 0, failureCount: 0
    };
  }
}
