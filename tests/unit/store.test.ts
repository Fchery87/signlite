import { useSessionStore } from '../../src/stores/session';

function makeDocument(docId: string, pageCount = 1, pageSize = { w: 612, h: 792 }) {
  return {
    docId,
    fileName: `${docId}.pdf`,
    pdfBytes: new ArrayBuffer(0),
    pageCount,
    pageSizes: Array.from({ length: pageCount }, () => pageSize),
    placements: [],
    status: 'pending' as const
  };
}

function resetStore() {
  useSessionStore.setState({
    session: {
      id: 'session-1',
      createdAt: 1,
      updatedAt: 1,
      documents: [],
      templatePlacements: [],
      signatureSnapshots: {}
    },
    selectedDocumentId: null,
    selectedPlacementId: null,
    copiedPlacement: null,
    history: { past: [], future: [] },
    view: 'dropzone'
  });
}

const basePlacement = {
  id: 'placement-1',
  type: 'signature' as const,
  assetId: 'asset-1',
  pageIndex: 0,
  x: 0.1,
  y: 0.2,
  w: 0.2,
  h: 0.1
};

describe('session store', () => {
  beforeEach(resetStore);

  it('adds documents and switches to editor view', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);

    const state = useSessionStore.getState();
    expect(state.view).toBe('editor');
    expect(state.session.documents).toHaveLength(1);
  });

  it('atomically inserts and deduplicates immutable signature snapshots', async () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    const asset = {
      kind: 'signature' as const,
      pngBytes: new Uint8Array([1, 2, 3]).buffer,
      width: 20,
      height: 10
    };

    const first = await useSessionStore.getState().addSignaturePlacement('doc-1', asset, {
      id: 'snapshot-placement-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1
    });
    const second = await useSessionStore.getState().addSignaturePlacement('doc-1', asset, {
      id: 'snapshot-placement-2', pageIndex: 0, x: 0.2, y: 0.2, w: 0.2, h: 0.1
    });

    const session = useSessionStore.getState().session;
    expect(first?.snapshotId).toBe(second?.snapshotId);
    expect(Object.keys(session.signatureSnapshots ?? {})).toHaveLength(1);
    expect(session.documents[0]?.placements.every((placement) => Boolean(placement.snapshotId))).toBe(true);
    expect(session.documents[0]?.placements.every((placement) => !placement.assetId && !placement.assetPngBytes)).toBe(true);
  });

  it('retains snapshots after placement deletion and undo history changes', async () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    await useSessionStore.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'initials', pngBytes: new Uint8Array([8]).buffer, width: 2, height: 1 },
      { id: 'snap-placement', pageIndex: 0, x: 0, y: 0, w: 0.2, h: 0.1 }
    );
    const snapshotId = useSessionStore.getState().session.documents[0]?.placements[0]?.snapshotId;
    useSessionStore.getState().removePlacement('doc-1', 'snap-placement');
    expect(useSessionStore.getState().session.signatureSnapshots?.[snapshotId!]).toBeDefined();
    useSessionStore.getState().undo();
    expect(useSessionStore.getState().session.documents[0]?.placements[0]?.snapshotId).toBe(snapshotId);
  });

  it('adds and removes placements', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'placement-1',
      type: 'signature',
      assetId: 'asset-1',
      pageIndex: 0,
      x: 0.1,
      y: 0.2,
      w: 0.2,
      h: 0.1
    });
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(1);
    useSessionStore.getState().removePlacement('doc-1', 'placement-1');
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(0);
    expect(useSessionStore.getState().session.documents[0]?.status).toBe('pending');
  });

  it('reorders documents and keeps the first doc as the template source', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1'), makeDocument('doc-2')]);
    useSessionStore.getState().addPlacement('doc-2', {
      id: 'placement-2',
      type: 'text',
      pageIndex: 0,
      x: 0.15,
      y: 0.2,
      w: 0.2,
      h: 0.08,
      value: 'Template text',
      fontSize: 12
    });

    useSessionStore.getState().reorderDocuments(['doc-2', 'doc-1']);

    const state = useSessionStore.getState();
    expect(state.session.documents.map((document) => document.docId)).toEqual(['doc-2', 'doc-1']);
    expect(state.session.templatePlacements).toHaveLength(1);
    expect(state.session.templatePlacements[0]?.value).toBe('Template text');
  });

  it('applies template placements to compatible docs and flags mismatches', () => {
    useSessionStore.getState().addDocuments([
      makeDocument('template', 2),
      makeDocument('doc-2', 2),
      makeDocument('doc-3', 1),
      makeDocument('doc-4', 2, { w: 792, h: 612 })
    ]);
    useSessionStore.getState().addPlacement('template', {
      id: 'placement-template',
      type: 'signature',
      assetId: 'asset-1',
      pageIndex: 1,
      x: 0.1,
      y: 0.1,
      w: 0.25,
      h: 0.1
    });

    const result = useSessionStore.getState().applyTemplatePlacements();
    const documents = useSessionStore.getState().session.documents;

    expect(result.appliedDocIds).toEqual(['doc-2']);
    expect(result.needsReviewDocIds).toEqual(['doc-3', 'doc-4']);
    expect(documents[1]?.placements).toHaveLength(1);
    expect(documents[1]?.placements[0]?.id).not.toBe('placement-template');
    expect(documents[1]?.status).toBe('placed');
    expect(documents[2]?.placements).toHaveLength(0);
    expect(documents[2]?.status).toBe('needs-review');
    expect(documents[2]?.batchError).toBe('Needs review — this document is missing a template page.');
    expect(documents[3]?.status).toBe('needs-review');
    expect(documents[3]?.batchError).toBe('Differs from template — review.');
  });

  it('duplicates a placement with a fresh id, small offset, and selection', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    useSessionStore.getState().addPlacement('doc-1', { ...basePlacement });

    useSessionStore.getState().duplicatePlacement('doc-1', 'placement-1');

    const state = useSessionStore.getState();
    const placements = state.session.documents[0]?.placements ?? [];
    expect(placements).toHaveLength(2);
    const clone = placements[1]!;
    expect(clone.id).not.toBe('placement-1');
    expect(clone.x).toBeCloseTo(basePlacement.x + 0.02);
    expect(clone.y).toBeCloseTo(basePlacement.y + 0.02);
    expect(clone.pageIndex).toBe(0);
    expect(state.selectedPlacementId).toBe(clone.id);
  });

  it('copies a placement and pastes it onto another page with a fresh id', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1', 2)]);
    useSessionStore.getState().addPlacement('doc-1', { ...basePlacement });

    useSessionStore.getState().copyPlacement('doc-1', 'placement-1');
    expect(useSessionStore.getState().copiedPlacement?.id).toBe('placement-1');

    const pasted = useSessionStore.getState().pastePlacement('doc-1', 1);

    const state = useSessionStore.getState();
    const placements = state.session.documents[0]?.placements ?? [];
    expect(pasted).not.toBeNull();
    expect(placements).toHaveLength(2);
    expect(placements[1]?.id).not.toBe('placement-1');
    expect(placements[1]?.pageIndex).toBe(1);
    expect(placements[1]?.x).toBeCloseTo(basePlacement.x);
    expect(state.selectedPlacementId).toBe(placements[1]?.id);
  });

  it('returns null when pasting with an empty clipboard', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    expect(useSessionStore.getState().pastePlacement('doc-1', 0)).toBeNull();
  });

  it('undoes and redoes placement changes', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    useSessionStore.getState().addPlacement('doc-1', { ...basePlacement });
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(1);

    useSessionStore.getState().undo();
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(0);
    expect(useSessionStore.getState().selectedPlacementId).toBeNull();

    useSessionStore.getState().redo();
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(1);
  });

  it('coalesces history pushes that share a key within the window', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    useSessionStore.getState().addPlacement('doc-1', { ...basePlacement, type: 'text', value: '' });

    // Simulate typing: one coalesced push per keystroke, then value updates.
    useSessionStore.getState().pushHistory('text:placement-1');
    useSessionStore.getState().updatePlacement('doc-1', 'placement-1', { value: 'H' });
    useSessionStore.getState().pushHistory('text:placement-1');
    useSessionStore.getState().updatePlacement('doc-1', 'placement-1', { value: 'Hi' });

    useSessionStore.getState().undo();
    // One undo reverses the whole typing burst, not one character.
    expect(useSessionStore.getState().session.documents[0]?.placements[0]?.value).toBe('');
  });

  it('clears history and clipboard when documents change', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    useSessionStore.getState().addPlacement('doc-1', { ...basePlacement });
    useSessionStore.getState().copyPlacement('doc-1', 'placement-1');

    useSessionStore.getState().removeDocument('doc-1');

    const state = useSessionStore.getState();
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
    expect(state.copiedPlacement).toBeNull();
    state.undo();
    expect(useSessionStore.getState().session.documents).toHaveLength(0);
  });

  it('preserves snapshot references through duplicate, copy, and paste', async () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1', 2)]);
    await useSessionStore.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([10, 20, 30]).buffer, width: 40, height: 20 },
      { id: 'snap-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    );
    const originalSnapshotId = useSessionStore.getState().session.documents[0]?.placements[0]?.snapshotId;

    useSessionStore.getState().duplicatePlacement('doc-1', 'snap-1');
    const afterDup = useSessionStore.getState().session.documents[0]?.placements ?? [];
    expect(afterDup[1]?.snapshotId).toBe(originalSnapshotId);
    expect(afterDup[1]?.id).not.toBe('snap-1');

    useSessionStore.getState().copyPlacement('doc-1', 'snap-1');
    expect(useSessionStore.getState().copiedPlacement?.snapshotId).toBe(originalSnapshotId);

    const pasted = useSessionStore.getState().pastePlacement('doc-1', 1);
    expect(pasted?.snapshotId).toBe(originalSnapshotId);
    expect(pasted?.pageIndex).toBe(1);

    // The snapshot pool still holds exactly one entry for all three placements.
    expect(Object.keys(useSessionStore.getState().session.signatureSnapshots ?? {})).toHaveLength(1);
  });

  it('preserves snapshot references through template application', async () => {
    useSessionStore.getState().addDocuments([
      makeDocument('template', 2),
      makeDocument('doc-2', 2)
    ]);
    await useSessionStore.getState().addSignaturePlacement(
      'template',
      { kind: 'signature', pngBytes: new Uint8Array([5, 6, 7]).buffer, width: 30, height: 10 },
      { id: 'tmpl-snap', pageIndex: 1, x: 0.1, y: 0.1, w: 0.25, h: 0.1 }
    );
    const originalSnapshotId = useSessionStore.getState().session.documents[0]?.placements[0]?.snapshotId;

    const result = useSessionStore.getState().applyTemplatePlacements();
    expect(result.appliedDocIds).toEqual(['doc-2']);

    const targetPlacements = useSessionStore.getState().session.documents[1]?.placements ?? [];
    expect(targetPlacements[0]?.snapshotId).toBe(originalSnapshotId);
    expect(targetPlacements[0]?.id).not.toBe('tmpl-snap');

    // The snapshot pool is shared, not duplicated.
    expect(Object.keys(useSessionStore.getState().session.signatureSnapshots ?? {})).toHaveLength(1);
  });
});
