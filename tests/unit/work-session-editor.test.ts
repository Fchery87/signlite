import { addSignaturePlacement, emptyHistory } from '../../src/lib/workSessionEditor';
import type { WorkSession, SessionDocument } from '../../src/db/schema';

const ASSET = {
  kind: 'signature' as const,
  pngBytes: new Uint8Array([10, 20, 30]).buffer,
  width: 200,
  height: 80
};

function makeDoc(docId: string, pageCount = 1): SessionDocument {
  return {
    docId,
    fileName: `${docId}.pdf`,
    pdfBytes: new ArrayBuffer(0),
    pageCount,
    pageSizes: Array.from({ length: pageCount }, () => ({ w: 612, h: 792 })),
    placements: [],
    status: 'pending'
  };
}

function makeSession(documents: SessionDocument[]): WorkSession {
  return {
    id: 'test-session',
    createdAt: 1,
    updatedAt: 1,
    documents,
    templatePlacements: [],
    signatureSnapshots: {}
  };
}

const PLACEMENT_INPUT = {
  id: 'placement-1',
  pageIndex: 0,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.1
};

describe('WorkSessionEditor.addSignaturePlacement', () => {
  it('produces a placement with snapshot, one history entry, and selection', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const history = emptyHistory();

    const result = await addSignaturePlacement(session, history, {
      docId: 'doc-1', asset: ASSET, placement: PLACEMENT_INPUT
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.placement.snapshotId).toBeTruthy();
    expect(result.placement.type).toBe('signature');

    const doc = result.session.documents.find((d) => d.docId === 'doc-1');
    expect(doc?.placements).toHaveLength(1);
    expect(doc?.status).toBe('placed');

    expect(result.history.past).toHaveLength(1);
    expect(result.session.signatureSnapshots?.[result.placement.snapshotId!]).toBeDefined();

    // Template placements synced from first document
    expect(result.session.templatePlacements).toHaveLength(1);
    expect(result.session.templatePlacements[0]?.snapshotId).toBeTruthy();
  });

  it('reuses an existing snapshot for identical assets', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const history = emptyHistory();

    const first = await addSignaturePlacement(session, history, {
      docId: 'doc-1', asset: ASSET, placement: { ...PLACEMENT_INPUT, id: 'p1' }
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await addSignaturePlacement(first.session, first.history, {
      docId: 'doc-1', asset: ASSET, placement: { ...PLACEMENT_INPUT, id: 'p2' }
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.placement.snapshotId).toBe(first.placement.snapshotId);
    expect(Object.keys(second.session.signatureSnapshots ?? {})).toHaveLength(1);
  });

  it('rejects when the document does not exist', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const history = emptyHistory();

    const result = await addSignaturePlacement(session, history, {
      docId: 'nonexistent', asset: ASSET, placement: PLACEMENT_INPUT
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('document-not-found');
  });

  it('rejects when the page index is out of range', async () => {
    const session = makeSession([makeDoc('doc-1', 2)]);
    const history = emptyHistory();

    const result = await addSignaturePlacement(session, history, {
      docId: 'doc-1', asset: ASSET, placement: { ...PLACEMENT_INPUT, pageIndex: 5 }
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('page-not-found');
  });

  it('rejects invalid geometry (negative x)', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const result = await addSignaturePlacement(session, emptyHistory(), {
      docId: 'doc-1', asset: ASSET, placement: { ...PLACEMENT_INPUT, x: -0.1 }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('invalid-geometry');
  });

  it('rejects invalid geometry (zero width)', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const result = await addSignaturePlacement(session, emptyHistory(), {
      docId: 'doc-1', asset: ASSET, placement: { ...PLACEMENT_INPUT, w: 0 }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('invalid-geometry');
  });

  it('rejects unsupported asset dimensions', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const result = await addSignaturePlacement(session, emptyHistory(), {
      docId: 'doc-1',
      asset: { ...ASSET, width: 0, height: 0 },
      placement: PLACEMENT_INPUT
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('unsupported-dimensions');
  });

  it('changes no state on rejection (history, session, snapshots all unchanged)', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    const history = emptyHistory();
    const originalSnapshotCount = Object.keys(session.signatureSnapshots ?? {}).length;

    const result = await addSignaturePlacement(session, history, {
      docId: 'nonexistent', asset: ASSET, placement: PLACEMENT_INPUT
    });

    expect(result.ok).toBe(false);
    expect(history.past).toHaveLength(0);
    expect(session.documents[0]?.placements).toHaveLength(0);
    expect(Object.keys(session.signatureSnapshots ?? {})).toHaveLength(originalSnapshotCount);
  });

  it('records one meaningful undo action per creation', async () => {
    const session = makeSession([makeDoc('doc-1')]);
    let history = emptyHistory();

    const r1 = await addSignaturePlacement(session, history, {
      docId: 'doc-1', asset: ASSET, placement: { ...PLACEMENT_INPUT, id: 'p1' }
    });
    if (!r1.ok) throw new Error('expected success');
    history = r1.history;

    const r2 = await addSignaturePlacement(r1.session, history, {
      docId: 'doc-1',
      asset: { ...ASSET, pngBytes: new Uint8Array([99]).buffer },
      placement: { ...PLACEMENT_INPUT, id: 'p2' }
    });
    if (!r2.ok) throw new Error('expected success');

    expect(r2.history.past).toHaveLength(2);
    // Each entry captures the state BEFORE the mutation
    expect(r2.history.past[0]?.documents[0]?.placements).toHaveLength(0);
    expect(r2.history.past[1]?.documents[0]?.placements).toHaveLength(1);
  });
});
