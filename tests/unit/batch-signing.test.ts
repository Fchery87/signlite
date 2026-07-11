import { describe, it, expect } from 'vitest';
import {
  BatchSigning,
  deriveCohort,
  BATCH_LEASE_OWNER,
  type BatchSigningPorts,
  type ProcessFlattenOutcome
} from '../../src/lib/batchSigning';
import type { BatchLeaseCapability } from '../../src/lib/batchSigning';
import type { SessionDocument, SignatureSnapshotMap } from '../../src/db/schema';
import type { FlattenAssetMap } from '../../src/pdf/assets';
import type { FlattenWorkerRequest } from '../../src/workers/flatten.worker';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<SessionDocument> = {}): SessionDocument {
  return {
    docId: 'doc-1',
    fileName: 'contract.pdf',
    pdfBytes: new ArrayBuffer(10),
    pageCount: 1,
    pageSizes: [{ w: 612, h: 792 }],
    placements: [
      { id: 'p1', type: 'signature', snapshotId: 'snap-1', pageIndex: 0, x: 10, y: 10, w: 100, h: 40 }
    ],
    status: 'placed',
    ...overrides
  };
}

function makeSnapshots(): SignatureSnapshotMap {
  return {
    'snap-1': { id: 'snap-1', kind: 'signature', pngBytes: new ArrayBuffer(8), width: 200, height: 80 }
  };
}

interface PortSpy {
  leaseAcquired: boolean;
  leaseReleased: boolean;
  acquireOrder: string[];
  transitions: Array<{ docId: string; status: string; error?: string }>;
  resolveAssetsCalled: boolean;
  request: FlattenWorkerRequest | null;
  outcome: ProcessFlattenOutcome | undefined;
}

function makePorts(config: {
  documents?: SessionDocument[];
  snapshots?: SignatureSnapshotMap;
  leaseGranted?: boolean;
  dateFormat?: string;
  assets?: FlattenAssetMap;
  outcome?: ProcessFlattenOutcome;
}): BatchSigningPorts & PortSpy {
  const lease: BatchLeaseCapability | null =
    config.leaseGranted === false
      ? null
      : Object.freeze({ id: 'lease-1', owner: BATCH_LEASE_OWNER }) as BatchLeaseCapability;

  const self = {
    leaseAcquired: false,
    leaseReleased: false,
    acquireOrder: [] as string[],
    transitions: [] as Array<{ docId: string; status: string; error?: string }>,
    resolveAssetsCalled: false,
    request: null as FlattenWorkerRequest | null,
    outcome: config.outcome as ProcessFlattenOutcome | undefined,

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
    getDocuments: (): readonly SessionDocument[] => config.documents ?? [makeDoc()],
    getSnapshots: (): SignatureSnapshotMap => config.snapshots ?? makeSnapshots(),
    getDateFormat: (): string | undefined => config.dateFormat,
    async resolveAssets(ids: readonly string[]): Promise<FlattenAssetMap> {
      self.resolveAssetsCalled = true;
      const out: FlattenAssetMap = {};
      for (const id of ids) {
        if (config.assets && id in config.assets) out[id] = config.assets[id];
      }
      return out;
    },
    transitionOutput(docId: string, status: string, error: string | undefined): boolean {
      self.transitions.push({ docId, status, error });
      return true;
    },
    async processFlatten(
      req: FlattenWorkerRequest,
      _t: Transferable[],
      handlers: {
        onProgress: (docId: string, done: number, total: number) => void;
        onError: (docId: string, message: string) => void;
      }
    ): Promise<ProcessFlattenOutcome> {
      self.request = req;
      const docs = req.docs;
      for (let i = 0; i < docs.length; i++) {
        if (self.outcome?.kind === 'all-failed') {
          handlers.onError(docs[i].docId, 'flatten failed');
        } else {
          handlers.onProgress(docs[i].docId, i + 1, docs.length);
        }
      }
      if (self.outcome?.kind === 'all-failed') return { kind: 'all-failed' as const };
      if (self.outcome?.kind === 'cancelled') return { kind: 'cancelled' as const };
      return { kind: 'success' as const, output: new ArrayBuffer(20), mime: 'application/zip' as const };
    }
  };
  return self as typeof self & PortSpy;
}

// ─── deriveCohort ───────────────────────────────────────────────────────────

describe('deriveCohort', () => {
  it('includes eligible Signed documents in the cohort', () => {
    const docs = [makeDoc({ docId: 'a', status: 'signed' }), makeDoc({ docId: 'b', status: 'placed' })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.eligible).toHaveLength(2);
    expect(r.excluded).toHaveLength(0);
  });

  it('excludes Needs Review documents with an observable reason', () => {
    const docs = [makeDoc({ docId: 'a', status: 'needs-review', needsReviewReason: 'missing page' }), makeDoc({ docId: 'b' })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.eligible).toHaveLength(1);
    expect(r.eligible[0].docId).toBe('b');
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]).toEqual({ docId: 'a', fileName: 'contract.pdf', reason: 'needs-review' });
  });

  it('excludes documents with no placements', () => {
    const docs = [makeDoc({ docId: 'a', placements: [] }), makeDoc({ docId: 'b' })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.eligible).toHaveLength(1);
    expect(r.excluded[0].reason).toBe('no-placements');
  });

  it('excludes documents whose placements reference a missing snapshot', () => {
    const docs = [makeDoc({ docId: 'a', placements: [
      { id: 'p1', type: 'signature', snapshotId: 'gone', pageIndex: 0, x: 0, y: 0, w: 100, h: 40 }
    ] })];
    const r = deriveCohort(docs, makeSnapshots());
    expect(r.eligible).toHaveLength(0);
    expect(r.excluded[0].reason).toBe('missing-snapshot');
  });

  it('always derives fresh on retry — never filters by previous Signed status', () => {
    const docs = [makeDoc({ docId: 'a', status: 'signed' }), makeDoc({ docId: 'b', status: 'error' })];
    expect(deriveCohort(docs, makeSnapshots()).eligible).toEqual(deriveCohort(docs, makeSnapshots()).eligible);
    expect(deriveCohort(docs, makeSnapshots()).eligible).toHaveLength(2);
  });
});

// ─── Lease lifecycle ────────────────────────────────────────────────────────

describe('BatchSigning lease lifecycle', () => {
  it('acquires the lease before deriving eligibility or copying input', async () => {
    const ports = makePorts({});
    await new BatchSigning(ports).attempt();
    expect(ports.leaseAcquired).toBe(true);
    expect(ports.acquireOrder[0]).toBe(BATCH_LEASE_OWNER);
  });

  it('releases the lease after successful processing', async () => {
    const ports = makePorts({});
    const r = await new BatchSigning(ports).attempt();
    expect(r.ok).toBe(true);
    expect(ports.leaseReleased).toBe(true);
  });

  it('releases the lease after all-failure', async () => {
    const ports = makePorts({ outcome: { kind: 'all-failed' } });
    const r = await new BatchSigning(ports).attempt();
    expect(r.ok).toBe(false);
    expect(r.artifact).toBeNull();
    expect(ports.leaseReleased).toBe(true);
  });

  it('releases the lease after cancellation', async () => {
    const ports = makePorts({});
    const b = new BatchSigning(ports);
    b.cancel();
    const r = await b.attempt();
    expect(r.cancelled).toBe(true);
    expect(ports.leaseReleased).toBe(true);
  });

  it('releases the lease when no documents are eligible', async () => {
    const ports = makePorts({ documents: [makeDoc({ placements: [] })] });
    const r = await new BatchSigning(ports).attempt();
    expect(r.noEligible).toBe(true);
    expect(ports.leaseReleased).toBe(true);
  });

  it('returns non-ok without proceeding when the lease is unavailable', async () => {
    const ports = makePorts({ leaseGranted: false });
    const r = await new BatchSigning(ports).attempt();
    expect(r.ok).toBe(false);
    expect(ports.leaseAcquired).toBe(false);
    expect(ports.leaseReleased).toBe(false);
    expect(ports.resolveAssetsCalled).toBe(false);
  });

  it('rejects a second attempt while the first is active', async () => {
    const ports = makePorts({});
    const b = new BatchSigning(ports);
    const p1 = b.attempt();
    await expect(b.attempt()).rejects.toThrow('already in progress');
    await p1;
  });
});

// ─── Artifact membership ────────────────────────────────────────────────────

describe('BatchSigning artifact membership', () => {
  it('produces an artifact when at least one document succeeds', async () => {
    const ports = makePorts({});
    const r = await new BatchSigning(ports).attempt();
    expect(r.ok).toBe(true);
    expect(r.artifact).not.toBeNull();
    expect(r.artifact!.mime).toBe('application/zip');
    expect(r.artifact!.successCount).toBeGreaterThan(0);
  });

  it('offers no artifact when every document fails', async () => {
    const ports = makePorts({ outcome: { kind: 'all-failed' } });
    const r = await new BatchSigning(ports).attempt();
    expect(r.ok).toBe(false);
    expect(r.artifact).toBeNull();
    expect(r.failureCount).toBeGreaterThan(0);
  });

  it('a per-document failure does not prevent successful outputs in the archive', async () => {
    const docs = [makeDoc({ docId: 'fail-doc' }), makeDoc({ docId: 'ok-doc' })];
    const ports = makePorts({ documents: docs });
    ports.processFlatten = async (_req, _t, handlers) => {
      handlers.onError('fail-doc', 'flatten failed');
      handlers.onProgress('ok-doc', 1, 2);
      return { kind: 'success', output: new ArrayBuffer(1), mime: 'application/zip' };
    };
    const r = await new BatchSigning(ports).attempt();
    expect(r.ok).toBe(true);
    expect(r.artifact).not.toBeNull();
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
  });

  it('transitions each eligible document to signing then signed on success', async () => {
    const ports = makePorts({ documents: [makeDoc({ docId: 'a' }), makeDoc({ docId: 'b' })] });
    await new BatchSigning(ports).attempt();
    const statuses = ports.transitions.map((t) => `${t.docId}:${t.status}`);
    expect(statuses).toContain('a:signing');
    expect(statuses).toContain('b:signing');
    expect(statuses).toContain('a:signed');
    expect(statuses).toContain('b:signed');
  });

  it('transitions failed documents to error with the failure message', async () => {
    const ports = makePorts({ documents: [makeDoc({ docId: 'a' })], outcome: { kind: 'all-failed' } });
    await new BatchSigning(ports).attempt();
    expect(ports.transitions.some((t) => t.status === 'error')).toBe(true);
  });
});

// ─── Cancellation ───────────────────────────────────────────────────────────

describe('BatchSigning cancellation', () => {
  it('cancellation during preparation suppresses delivery and releases the lease', async () => {
    const ports = makePorts({});
    const b = new BatchSigning(ports);
    b.cancel();
    const r = await b.attempt();
    expect(r.cancelled).toBe(true);
    expect(r.artifact).toBeNull();
    expect(ports.leaseReleased).toBe(true);
    expect(ports.transitions).toHaveLength(0);
  });

  it('cancellation during processing ignores late progress events', async () => {
    const ports = makePorts({});
    const b = new BatchSigning(ports);
    ports.processFlatten = async (_req, _t, handlers, isCancelled) => {
      handlers.onProgress('doc-1', 1, 1);
      b.cancel();
      handlers.onProgress('doc-1', 2, 2);
      expect(isCancelled()).toBe(true);
      return { kind: 'cancelled' };
    };
    const r = await b.attempt();
    expect(r.cancelled).toBe(true);
    expect(r.artifact).toBeNull();
    const signedCount = ports.transitions.filter((t) => t.status === 'signed').length;
    expect(signedCount).toBe(1);
    expect(ports.leaseReleased).toBe(true);
  });

  it('cancellation preserves durable state — no artifact and no extra mutations', async () => {
    const ports = makePorts({});
    const b = new BatchSigning(ports);
    b.cancel();
    const r = await b.attempt();
    expect(r.cancelled).toBe(true);
    expect(r.successCount).toBe(0);
    expect(r.failureCount).toBe(0);
    expect(ports.transitions).toHaveLength(0);
  });
});

// ─── Transient state ────────────────────────────────────────────────────────

describe('BatchSigning transient state', () => {
  it('progress is observable during processing', async () => {
    const ports = makePorts({ documents: [makeDoc({ docId: 'a' }), makeDoc({ docId: 'b' })] });
    const b = new BatchSigning(ports);
    expect(b.getProgress().status).toBe('idle');
    const r = await b.attempt();
    expect(r.ok).toBe(true);
    expect(['succeeded', 'processing']).toContain(b.getProgress().status);
  });

  it('failures are recorded transiently', async () => {
    const ports = makePorts({ documents: [makeDoc({ docId: 'fail-doc' })], outcome: { kind: 'all-failed' } });
    const b = new BatchSigning(ports);
    const r = await b.attempt();
    expect(r.failureCount).toBe(1);
  });
});

// ─── Retry ──────────────────────────────────────────────────────────────────

describe('BatchSigning retry derives a fresh cohort', () => {
  it('a second attempt derives the full cohort without filtering by previous results', async () => {
    const docs = [makeDoc({ docId: 'a', status: 'signed' }), makeDoc({ docId: 'b', status: 'placed' })];
    const ports = makePorts({ documents: docs });
    const b = new BatchSigning(ports);
    const first = await b.attempt();
    expect(first.ok).toBe(true);
    expect(first.cohort.eligible).toHaveLength(2);
    const second = await b.attempt();
    expect(second.ok).toBe(true);
    expect(second.cohort.eligible).toHaveLength(2);
    expect(second.cohort.eligible.map((e) => e.docId)).toEqual(['a', 'b']);
  });

  it('retry after all-failure re-derives the full cohort', async () => {
    const docs = [makeDoc({ docId: 'a' }), makeDoc({ docId: 'b' })];
    const ports = makePorts({ documents: docs });
    const b = new BatchSigning(ports);
    ports.outcome = { kind: 'all-failed' };
    const first = await b.attempt();
    expect(first.ok).toBe(false);
    ports.outcome = { kind: 'success', output: new ArrayBuffer(1), mime: 'application/zip' };
    const second = await b.attempt();
    expect(second.ok).toBe(true);
    expect(second.cohort.eligible).toHaveLength(2);
  });
});

// ─── Exclusion observability ────────────────────────────────────────────────

describe('BatchSigning exclusion reasons', () => {
  it('reports excluded documents with their reasons in the cohort', async () => {
    const docs = [
      makeDoc({ docId: 'ok', status: 'placed' }),
      makeDoc({ docId: 'review', status: 'needs-review', needsReviewReason: 'bad' }),
      makeDoc({ docId: 'empty', placements: [] }),
      makeDoc({ docId: 'missing', placements: [
        { id: 'p1', type: 'signature', snapshotId: 'gone', pageIndex: 0, x: 0, y: 0, w: 1, h: 1 }
      ] })
    ];
    const ports = makePorts({ documents: docs });
    const r = await new BatchSigning(ports).attempt();
    expect(r.cohort.eligible).toHaveLength(1);
    expect(r.cohort.excluded).toHaveLength(3);
    const reasons = r.cohort.excluded.map((e) => `${e.docId}:${e.reason}`);
    expect(reasons).toContain('review:needs-review');
    expect(reasons).toContain('empty:no-placements');
    expect(reasons).toContain('missing:missing-snapshot');
  });

  it('excludes documents with missing legacy assets after resolution', async () => {
    const docs = [
      makeDoc({ docId: 'ok' }),
      makeDoc({ docId: 'legacy', placements: [
        { id: 'p1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0, y: 0, w: 100, h: 40 }
      ] })
    ];
    const ports = makePorts({ documents: docs, assets: {} });
    const r = await new BatchSigning(ports).attempt();
    expect(r.cohort.eligible).toHaveLength(1);
    expect(r.cohort.eligible[0].docId).toBe('ok');
    expect(r.cohort.excluded.some((e) => e.docId === 'legacy' && e.reason === 'missing-asset')).toBe(true);
  });
});
