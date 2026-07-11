import { describe, it, expect } from 'vitest';
import {
  BatchSigning,
  deriveCohort,
  BATCH_LEASE_OWNER,
  type BatchSigningPorts,
  type BatchArtifact,
  type ProcessFlattenOutcome
} from '../../src/lib/batchSigning';
import type { BatchLeaseCapability } from '../../src/lib/batchSigning';
import type { SessionDocument, SignatureSnapshotMap } from '../../src/db/schema';
import type { FlattenAssetMap } from '../../src/pdf/assets';
import type { FlattenWorkerRequest } from '../../src/workers/flatten.worker';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<SessionDocument> = {}): SessionDocument {
  return {
    docId: 'doc-1', fileName: 'contract.pdf', pdfBytes: new ArrayBuffer(10),
    pageCount: 1, pageSizes: [{ w: 612, h: 792 }],
    placements: [{ id: 'p1', type: 'signature', snapshotId: 'snap-1', pageIndex: 0, x: 10, y: 10, w: 100, h: 40 }],
    status: 'placed', ...overrides
  };
}

function makeSnapshots(): SignatureSnapshotMap {
  return { 'snap-1': { id: 'snap-1', kind: 'signature', pngBytes: new ArrayBuffer(8), width: 200, height: 80 } };
}

interface PortSpy {
  leaseAcquired: boolean;
  leaseReleased: boolean;
  acquireOrder: string[];
  transitions: Array<{ docId: string; status: string; error?: string }>;
  resolveAssetsCalled: boolean;
  request: FlattenWorkerRequest | null;
  outcome: ProcessFlattenOutcome | undefined;
  deliveredArtifact: BatchArtifact | null;
  deliveryResult: boolean;
  confirmedDocIds: string[] | null;
}

function makePorts(config: {
  documents?: SessionDocument[];
  snapshots?: SignatureSnapshotMap;
  leaseGranted?: boolean;
  dateFormat?: string;
  assets?: FlattenAssetMap;
  outcome?: ProcessFlattenOutcome;
  deliveryResult?: boolean;
}): BatchSigningPorts & PortSpy {
  const lease: BatchLeaseCapability | null =
    config.leaseGranted === false ? null : Object.freeze({ id: 'lease-1', owner: BATCH_LEASE_OWNER }) as BatchLeaseCapability;

  const self = {
    leaseAcquired: false, leaseReleased: false,
    acquireOrder: [] as string[],
    transitions: [] as Array<{ docId: string; status: string; error?: string }>,
    resolveAssetsCalled: false,
    request: null as FlattenWorkerRequest | null,
    outcome: config.outcome as ProcessFlattenOutcome | undefined,
    deliveredArtifact: null as BatchArtifact | null,
    deliveryResult: config.deliveryResult ?? true,
    confirmedDocIds: null as string[] | null,

    acquireLease(owner: string): BatchLeaseCapability | null {
      self.acquireOrder.push(owner);
      if (config.leaseGranted === false) return null;
      self.leaseAcquired = true;
      return lease;
    },
    releaseLease(cap: BatchLeaseCapability): boolean {
      if (cap !== lease) return false;
      self.leaseReleased = true;
      return true;
    },
    getDocuments: () => config.documents ?? [makeDoc()],
    getSnapshots: () => config.snapshots ?? makeSnapshots(),
    getDateFormat: () => config.dateFormat,
    async resolveAssets(ids: readonly string[]) {
      self.resolveAssetsCalled = true;
      const out: FlattenAssetMap = {};
      for (const id of ids) { if (config.assets && id in config.assets) out[id] = config.assets[id]; }
      return out;
    },
    transitionOutput(docId: string, status: string, error: string | undefined) {
      self.transitions.push({ docId, status, error });
      return true;
    },
    async processFlatten(req: FlattenWorkerRequest, _t: Transferable[], handlers: {
      onProgress: (d: string, done: number, total: number) => void; onError: (d: string, m: string) => void;
    }) {
      self.request = req;
      const docs = req.docs;
      for (let i = 0; i < docs.length; i++) {
        if (self.outcome?.kind === 'all-failed') handlers.onError(docs[i].docId, 'flatten failed');
        else handlers.onProgress(docs[i].docId, i + 1, docs.length);
      }
      if (self.outcome?.kind === 'all-failed') return { kind: 'all-failed' as const };
      if (self.outcome?.kind === 'cancelled') return { kind: 'cancelled' as const };
      return { kind: 'success' as const, output: new ArrayBuffer(20), mime: 'application/zip' as const };
    },
    async deliverArtifact(artifact: BatchArtifact) {
      self.deliveredArtifact = artifact;
      return self.deliveryResult;
    },
    confirmBatchSigned(docIds: readonly string[]) {
      self.confirmedDocIds = [...docIds];
      return true;
    }
  };
  return self as typeof self & PortSpy;
}

// ─── deriveCohort ───────────────────────────────────────────────────────────

describe('deriveCohort', () => {
  it('includes eligible Signed documents', () => {
    const docs = [makeDoc({ docId: 'a', status: 'signed' }), makeDoc({ docId: 'b', status: 'placed' })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.eligible).toHaveLength(2);
    expect(r.excluded).toHaveLength(0);
  });
  it('excludes Needs Review with observable reason', () => {
    const docs = [makeDoc({ docId: 'a', status: 'needs-review', needsReviewReason: 'bad' }), makeDoc({ docId: 'b' })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.eligible).toHaveLength(1);
    expect(r.excluded[0]).toEqual({ docId: 'a', fileName: 'contract.pdf', reason: 'needs-review' });
  });
  it('excludes no-placements', () => {
    const docs = [makeDoc({ docId: 'a', placements: [] }), makeDoc({ docId: 'b' })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.excluded[0].reason).toBe('no-placements');
  });
  it('excludes missing-snapshot', () => {
    const docs = [makeDoc({ docId: 'a', placements: [{ id: 'p1', type: 'signature', snapshotId: 'gone', pageIndex: 0, x: 0, y: 0, w: 1, h: 1 }] })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.excluded[0].reason).toBe('missing-snapshot');
  });
  it('always derives fresh on retry', () => {
    const docs = [makeDoc({ docId: 'a', status: 'signed' }), makeDoc({ docId: 'b', status: 'error' })];
    expect(deriveCohort(docs, makeSnapshots()).eligible).toHaveLength(2);
  });
});

// ─── Lease lifecycle ────────────────────────────────────────────────────────

describe('BatchSigning lease lifecycle', () => {
  it('acquires lease before eligibility', async () => {
    const p = makePorts({}); await new BatchSigning(p).attempt();
    expect(p.leaseAcquired).toBe(true);
    expect(p.acquireOrder[0]).toBe(BATCH_LEASE_OWNER);
  });
  it('releases after success', async () => {
    const p = makePorts({}); const r = await new BatchSigning(p).attempt();
    expect(r.ok).toBe(true); expect(p.leaseReleased).toBe(true);
  });
  it('releases after all-failure', async () => {
    const p = makePorts({ outcome: { kind: 'all-failed' } }); const r = await new BatchSigning(p).attempt();
    expect(r.ok).toBe(false); expect(p.leaseReleased).toBe(true);
  });
  it('releases after cancellation', async () => {
    const p = makePorts({}); const b = new BatchSigning(p); b.cancel();
    const r = await b.attempt();
    expect(r.cancelled).toBe(true); expect(p.leaseReleased).toBe(true);
  });
  it('releases when no eligible', async () => {
    const p = makePorts({ documents: [makeDoc({ placements: [] })] });
    const r = await new BatchSigning(p).attempt();
    expect(r.noEligible).toBe(true); expect(p.leaseReleased).toBe(true);
  });
  it('returns non-ok without proceeding when lease unavailable', async () => {
    const p = makePorts({ leaseGranted: false }); const r = await new BatchSigning(p).attempt();
    expect(r.ok).toBe(false); expect(p.resolveAssetsCalled).toBe(false);
  });
  it('rejects second attempt while first active', async () => {
    const p = makePorts({}); const b = new BatchSigning(p);
    const p1 = b.attempt();
    await expect(b.attempt()).rejects.toThrow('already in progress');
    await p1;
  });
});

// ─── Delivery and Signed transitions ────────────────────────────────────────

describe('BatchSigning delivery and Signed transitions', () => {
  it('worker progress never establishes Signed state', async () => {
    const p = makePorts({ documents: [makeDoc({ docId: 'a' })] });
    await new BatchSigning(p).attempt();
    const signedByWorker = p.transitions.filter((t) => t.status === 'signed').length;
    expect(signedByWorker).toBe(0);
  });

  it('confirmBatchSigned is called with only successful docIds after delivery', async () => {
    const p = makePorts({ documents: [makeDoc({ docId: 'a' }), makeDoc({ docId: 'b' })] });
    await new BatchSigning(p).attempt();
    expect(p.confirmedDocIds).toEqual(['a', 'b']);
  });

  it('only successful docs are confirmed Signed — per-doc failure excluded', async () => {
    const docs = [makeDoc({ docId: 'fail' }), makeDoc({ docId: 'ok' })];
    const p = makePorts({ documents: docs });
    p.processFlatten = async (_req, _t, handlers) => {
      handlers.onError('fail', 'flatten failed');
      handlers.onProgress('ok', 1, 2);
      return { kind: 'success', output: new ArrayBuffer(1), mime: 'application/zip' };
    };
    const b = new BatchSigning(p);
    const r = await b.attempt();
    expect(r.ok).toBe(true);
    expect(p.confirmedDocIds).toEqual(['ok']);
  });

  it('delivery success transitions confirmed docs to Signed', async () => {
    const p = makePorts({ documents: [makeDoc({ docId: 'a' })] });
    await new BatchSigning(p).attempt();
    expect(p.confirmedDocIds).toContain('a');
  });

  it('delivery failure creates no Signed transitions', async () => {
    const p = makePorts({ documents: [makeDoc({ docId: 'a' })], deliveryResult: false });
    const r = await new BatchSigning(p).attempt();
    expect(r.ok).toBe(false);
    expect(r.deliveryFailed).toBe(true);
    expect(p.confirmedDocIds).toBeNull();
  });

  it('delivery is non-cancelable — cancel during delivery is ignored', async () => {
    const p = makePorts({ documents: [makeDoc({ docId: 'a' })] });
    const b = new BatchSigning(p);
    p.deliverArtifact = async (artifact: BatchArtifact) => {
      p.deliveredArtifact = artifact;
      b.cancel(); // Should be ignored during delivery
      return true;
    };
    const r = await b.attempt();
    expect(r.ok).toBe(true);
    expect(r.cancelled).toBe(false);
    expect(p.confirmedDocIds).toContain('a');
  });

  it('all-failure produces no artifact', async () => {
    const p = makePorts({ outcome: { kind: 'all-failed' } });
    const r = await new BatchSigning(p).attempt();
    expect(r.ok).toBe(false);
    expect(r.artifact).toBeNull();
    expect(p.confirmedDocIds).toBeNull();
  });

  it('per-doc failure does not prevent successful outputs in archive', async () => {
    const docs = [makeDoc({ docId: 'fail' }), makeDoc({ docId: 'ok' })];
    const p = makePorts({ documents: docs });
    p.processFlatten = async (_req, _t, handlers) => {
      handlers.onError('fail', 'flatten failed');
      handlers.onProgress('ok', 1, 2);
      return { kind: 'success', output: new ArrayBuffer(1), mime: 'application/zip' };
    };
    const r = await new BatchSigning(p).attempt();
    expect(r.ok).toBe(true);
    expect(r.artifact).not.toBeNull();
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
  });
});

// ─── Cancellation ───────────────────────────────────────────────────────────

describe('BatchSigning cancellation', () => {
  it('cancel during preparation suppresses delivery', async () => {
    const p = makePorts({}); const b = new BatchSigning(p); b.cancel();
    const r = await b.attempt();
    expect(r.cancelled).toBe(true);
    expect(r.artifact).toBeNull();
    expect(p.leaseReleased).toBe(true);
    expect(p.transitions).toHaveLength(0);
    expect(p.confirmedDocIds).toBeNull();
  });
  it('cancel during processing ignores late events', async () => {
    const p = makePorts({}); const b = new BatchSigning(p);
    p.processFlatten = async (_req, _t, handlers, isCancelled) => {
      handlers.onProgress('doc-1', 1, 1);
      b.cancel();
      handlers.onProgress('doc-1', 2, 2);
      expect(isCancelled()).toBe(true);
      return { kind: 'cancelled' };
    };
    const r = await b.attempt();
    expect(r.cancelled).toBe(true);
    expect(r.artifact).toBeNull();
    expect(p.confirmedDocIds).toBeNull();
    expect(p.leaseReleased).toBe(true);
  });
  it('cancel preserves durable state', async () => {
    const p = makePorts({}); const b = new BatchSigning(p); b.cancel();
    const r = await b.attempt();
    expect(r.successCount).toBe(0);
    expect(r.failureCount).toBe(0);
  });
});

// ─── Retry ──────────────────────────────────────────────────────────────────

describe('BatchSigning retry', () => {
  it('second attempt derives full cohort without filtering', async () => {
    const docs = [makeDoc({ docId: 'a', status: 'signed' }), makeDoc({ docId: 'b', status: 'placed' })];
    const p = makePorts({ documents: docs }); const b = new BatchSigning(p);
    const first = await b.attempt();
    expect(first.ok).toBe(true); expect(first.cohort.eligible).toHaveLength(2);
    const second = await b.attempt();
    expect(second.ok).toBe(true); expect(second.cohort.eligible).toHaveLength(2);
  });
  it('retry after all-failure re-derives full cohort', async () => {
    const docs = [makeDoc({ docId: 'a' }), makeDoc({ docId: 'b' })];
    const p = makePorts({ documents: docs }); const b = new BatchSigning(p);
    p.outcome = { kind: 'all-failed' };
    const first = await b.attempt();
    expect(first.ok).toBe(false);
    p.outcome = { kind: 'success', output: new ArrayBuffer(1), mime: 'application/zip' };
    const second = await b.attempt();
    expect(second.ok).toBe(true); expect(second.cohort.eligible).toHaveLength(2);
  });
  it('retry after delivery failure re-derives full cohort', async () => {
    const docs = [makeDoc({ docId: 'a' })];
    const p = makePorts({ documents: docs, deliveryResult: false }); const b = new BatchSigning(p);
    const first = await b.attempt();
    expect(first.deliveryFailed).toBe(true);
    p.deliveryResult = true;
    const second = await b.attempt();
    expect(second.ok).toBe(true); expect(second.cohort.eligible).toHaveLength(1);
  });
});

// ─── Exclusion observability ────────────────────────────────────────────────

describe('BatchSigning exclusion reasons', () => {
  it('reports excluded documents with reasons', async () => {
    const docs = [
      makeDoc({ docId: 'ok', status: 'placed' }),
      makeDoc({ docId: 'review', status: 'needs-review', needsReviewReason: 'bad' }),
      makeDoc({ docId: 'empty', placements: [] }),
      makeDoc({ docId: 'missing', placements: [{ id: 'p1', type: 'signature', snapshotId: 'gone', pageIndex: 0, x: 0, y: 0, w: 1, h: 1 }] })
    ];
    const p = makePorts({ documents: docs });
    const r = await new BatchSigning(p).attempt();
    expect(r.cohort.eligible).toHaveLength(1);
    const reasons = r.cohort.excluded.map((e) => `${e.docId}:${e.reason}`);
    expect(reasons).toContain('review:needs-review');
    expect(reasons).toContain('empty:no-placements');
    expect(reasons).toContain('missing:missing-snapshot');
  });
  it('excludes missing legacy assets after resolution', async () => {
    const docs = [
      makeDoc({ docId: 'ok' }),
      makeDoc({ docId: 'legacy', placements: [{ id: 'p1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0, y: 0, w: 100, h: 40 }] })
    ];
    const p = makePorts({ documents: docs, assets: {} });
    const r = await new BatchSigning(p).attempt();
    expect(r.cohort.eligible).toHaveLength(1);
    expect(r.cohort.excluded.some((e) => e.docId === 'legacy' && e.reason === 'missing-asset')).toBe(true);
  });
});
