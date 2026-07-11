import { saveAsset } from '../../src/db/signatures';
import { normalizeSession } from '../../src/lib/normalizeSession';
import type { WorkSession, Placement, SessionDocument } from '../../src/db/schema';

// Minimal valid PNG (1x1 transparent) with correct IHDR dimensions.
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, // width = 1
  0x00, 0x00, 0x00, 0x01, // height = 1
  0x08, 0x06, 0x00, 0x00, 0x00,
  0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x0d,
  0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
  0xff, 0x00, 0x00, 0x00, 0x09,
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82
]).buffer;

// Another minimal PNG with different dimensions (2x3).
const PNG_2x3 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, // width = 2
  0x00, 0x00, 0x00, 0x03, // height = 3
  0x08, 0x06, 0x00, 0x00, 0x00,
  0xb5, 0x1e, 0x36, 0x24,
  0x00, 0x00, 0x00, 0x0d,
  0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
  0xff, 0x00, 0x00, 0x00, 0x09,
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82
]).buffer;

function makeDoc(docId: string, placements: Placement[] = [], overrides: Partial<SessionDocument> = {}): SessionDocument {
  return {
    docId,
    fileName: `${docId}.pdf`,
    pdfBytes: new ArrayBuffer(0),
    pageCount: 1,
    pageSizes: [{ w: 612, h: 792 }],
    placements,
    status: 'pending',
    ...overrides
  };
}

function makeSession(documents: SessionDocument[], overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'test-session',
    createdAt: 1,
    updatedAt: 1,
    documents,
    templatePlacements: [],
    ...overrides
  };
}

function legacySig(id: string, opts: { assetId?: string; assetPngBytes?: ArrayBuffer } = {}): Placement {
  return { id, type: 'signature', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1, ...opts };
}

describe('normalizeSession', () => {
  // AC1: Legacy Placement with valid embedded image interned into snapshot pool
  it('interns a legacy placement with embedded bytes into the snapshot pool', async () => {
    const session = makeSession([makeDoc('doc-1', [legacySig('sig-1', { assetPngBytes: PNG_1x1.slice(0) })])]);
    const result = await normalizeSession(session);

    const placement = result.documents[0]?.placements[0];
    expect(placement?.snapshotId).toBeTruthy();
    expect(placement?.assetPngBytes).toBeUndefined();
    expect(placement?.assetId).toBeUndefined();
    expect(result.signatureSnapshots?.[placement!.snapshotId!]).toBeDefined();
  });

  // AC2: Legacy Placement without embedded bytes recovered from library
  it('recovers a legacy placement without embedded bytes from the library', async () => {
    const asset = await saveAsset({
      kind: 'signature', source: 'uploaded', pngBytes: PNG_2x3.slice(0),
      width: 2, height: 3, label: 'My sig'
    });
    const session = makeSession([makeDoc('doc-1', [legacySig('sig-1', { assetId: asset.id })])]);
    const result = await normalizeSession(session);

    const placement = result.documents[0]?.placements[0];
    expect(placement?.snapshotId).toBeTruthy();
    expect(placement?.assetId).toBeUndefined();
    expect(result.signatureSnapshots?.[placement!.snapshotId!]).toBeDefined();
  });

  // AC3: Unrecoverable Placement marks document needs-review with visible reason
  it('marks a document needs-review when a signature cannot be recovered', async () => {
    const session = makeSession([makeDoc('doc-1', [legacySig('sig-1', { assetId: 'deleted-asset-id' })])]);
    const result = await normalizeSession(session);

    expect(result.documents[0]?.status).toBe('pending');
    expect(result.documents[0]?.needsReviewReason).toBeTruthy();
    expect(result.documents[0]?.placements).toHaveLength(1);
  });

  // AC4: One unrecoverable document does not prevent the rest from resuming
  it('keeps unaffected documents usable when one document is unrecoverable', async () => {
    const session = makeSession([
      makeDoc('doc-1', [legacySig('sig-1', { assetPngBytes: PNG_1x1.slice(0) })], { status: 'placed' }),
      makeDoc('doc-2', [legacySig('sig-2', { assetId: 'deleted-asset-id' })]),
      makeDoc('doc-3', [{ id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.3, w: 0.2, h: 0.08, value: 'Hello', fontSize: 12 }], { status: 'placed' })
    ]);
    const result = await normalizeSession(session);

    expect(result.documents[0]?.needsReviewReason).toBeUndefined();
    expect(result.documents[0]?.placements[0]?.snapshotId).toBeTruthy();
    expect(result.documents[1]?.needsReviewReason).toBeTruthy();
    expect(result.documents[2]?.needsReviewReason).toBeUndefined();
  });

  // AC5: Template placements repaired from first document
  it('syncs template placements from the first document after normalization', async () => {
    const session = makeSession([
      makeDoc('doc-1', [
        legacySig('sig-1', { assetPngBytes: PNG_1x1.slice(0) }),
        { id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.3, w: 0.2, h: 0.08, value: 'Note', fontSize: 12 }
      ])
    ]);
    const result = await normalizeSession(session);

    expect(result.templatePlacements).toHaveLength(2);
    expect(result.templatePlacements[0]?.snapshotId).toBeTruthy();
  });

  // AC6: Idempotent
  it('is idempotent — running twice produces the same snapshot pool size', async () => {
    const session = makeSession([
      makeDoc('doc-1', [
        legacySig('sig-1', { assetPngBytes: PNG_1x1.slice(0) }),
        legacySig('sig-2', { assetPngBytes: PNG_2x3.slice(0) })
      ])
    ]);
    const first = await normalizeSession(session);
    expect(Object.keys(first.signatureSnapshots ?? {})).toHaveLength(2);

    const second = await normalizeSession(first);
    expect(Object.keys(second.signatureSnapshots ?? {})).toHaveLength(2);
    expect(second.documents[0]?.placements[0]?.snapshotId).toBe(first.documents[0]?.placements[0]?.snapshotId);
  });

  // Signed is durable while signing is transient
  it('preserves signed and clears signing status after normalization', async () => {
    const session = makeSession([
      makeDoc('doc-1', [legacySig('sig-1', { assetPngBytes: PNG_1x1.slice(0) })], { status: 'signed' }),
      makeDoc('doc-2', [legacySig('sig-2', { assetPngBytes: PNG_2x3.slice(0) })], { status: 'signing' })
    ]);
    const result = await normalizeSession(session);

    expect(result.documents[0]?.status).toBe('signed');
    expect(result.documents[1]?.status).toBe('placed');
  });

  // Deduplication
  it('deduplicates identical embedded images into one snapshot', async () => {
    const session = makeSession([
      makeDoc('doc-1', [
        legacySig('sig-1', { assetPngBytes: PNG_1x1.slice(0) }),
        legacySig('sig-2', { assetPngBytes: PNG_1x1.slice(0) })
      ])
    ]);
    const result = await normalizeSession(session);

    expect(result.documents[0]?.placements[0]?.snapshotId).toBe(result.documents[0]?.placements[1]?.snapshotId);
    expect(Object.keys(result.signatureSnapshots ?? {})).toHaveLength(1);
  });

  // Already-normalized pass-through
  it('does not touch already-normalized placements with existing snapshots', async () => {
    const existingSnapshotId = 'sha256-existing';
    const session = makeSession(
      [makeDoc('doc-1', [{ id: 'sig-1', type: 'signature', snapshotId: existingSnapshotId, pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }])],
      { signatureSnapshots: { [existingSnapshotId]: { id: existingSnapshotId, kind: 'signature', pngBytes: PNG_1x1.slice(0), width: 1, height: 1 } } }
    );
    const result = await normalizeSession(session);

    expect(result.documents[0]?.placements[0]?.snapshotId).toBe(existingSnapshotId);
    expect(Object.keys(result.signatureSnapshots ?? {})).toHaveLength(1);
  });

  it('migrates legacy needs-review status into orthogonal review state', async () => {
    const session = makeSession([
      makeDoc('doc-1', [
        { id: 'text-1', type: 'text', pageIndex: 0, x: 0.1, y: 0.3, w: 0.2, h: 0.08, value: 'Hello', fontSize: 12 }
      ], { status: 'needs-review', batchError: 'Legacy review reason' })
    ]);
    const result = await normalizeSession(session);

    expect(result.documents[0]).toMatchObject({
      status: 'placed', needsReviewReason: 'Legacy review reason', batchError: undefined
    });
  });

});
