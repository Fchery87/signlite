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
    view: 'dropzone',
    ownershipRevision: 0,
    contentRevision: 0
  });
}

const basePlacement = {
  id: 'placement-1',
  type: 'text' as const,
  value: 'Signer',
  fontSize: 12,
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

  it('does not restore a document removed while a signature snapshot resolves', async () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);

    const pending = useSessionStore.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([1, 2, 3]).buffer, width: 20, height: 10 },
      { id: 'racing-placement', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    );
    useSessionStore.getState().removeDocument('doc-1');

    await expect(pending).resolves.toBeNull();
    expect(useSessionStore.getState().session.documents).toHaveLength(0);
    expect(useSessionStore.getState().session.signatureSnapshots).toEqual({});
  });

  it('does not apply stale signature work to replacement resources with the same document identity', async () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);
    const pending = useSessionStore.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([4, 5, 6]).buffer, width: 20, height: 10 },
      { id: 'stale-placement', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    );

    useSessionStore.getState().replaceSession({
      id: 'replacement-session', createdAt: 2, updatedAt: 2,
      documents: [makeDocument('doc-1')], templatePlacements: [], signatureSnapshots: {}
    });

    await expect(pending).resolves.toBeNull();
    const state = useSessionStore.getState();
    expect(state.session.id).toBe('replacement-session');
    expect(state.session.documents[0]?.placements).toEqual([]);
    expect(state.history).toEqual({ past: [], future: [] });
  });

  it('does not restore a normalized candidate after Start Fresh supersedes it', async () => {
    const pending = useSessionStore.getState().restoreSession({
      id: 'saved-session', createdAt: 2, updatedAt: 2,
      documents: [makeDocument('doc-1')], templatePlacements: [], signatureSnapshots: {}
    });
    useSessionStore.getState().resetSession();

    await expect(pending).resolves.toBe(false);
    expect(useSessionStore.getState().session.id).not.toBe('saved-session');
    expect(useSessionStore.getState().session.documents).toEqual([]);
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
      type: 'text',
      value: 'Template',
      fontSize: 12,
      pageIndex: 1,
      x: 0.1,
      y: 0.1,
      w: 0.25,
      h: 0.1
    });

    const preview = useSessionStore.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected preview');
    const result = useSessionStore.getState().applyTemplatePlacements(preview);
    const documents = useSessionStore.getState().session.documents;

    expect(result.appliedDocIds).toEqual(['doc-2']);
    expect(result.needsReviewDocIds).toEqual(['doc-3', 'doc-4']);
    expect(documents[1]?.placements).toHaveLength(1);
    expect(documents[1]?.placements[0]?.id).not.toBe('placement-template');
    expect(documents[1]?.status).toBe('placed');
    expect(documents[2]?.placements).toHaveLength(0);
    expect(documents[2]?.status).toBe('pending');
    expect(documents[2]?.needsReviewReason).toBe('Needs review — this document is missing a template page.');
    expect(documents[3]?.status).toBe('pending');
    expect(documents[3]?.needsReviewReason).toBe('Differs from template — review.');
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

    const preview = useSessionStore.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected preview');
    const result = useSessionStore.getState().applyTemplatePlacements(preview);
    expect(result.appliedDocIds).toEqual(['doc-2']);

    const targetPlacements = useSessionStore.getState().session.documents[1]?.placements ?? [];
    expect(targetPlacements[0]?.snapshotId).toBe(originalSnapshotId);
    expect(targetPlacements[0]?.id).not.toBe('tmpl-snap');

    // The snapshot pool is shared, not duplicated.
    expect(Object.keys(useSessionStore.getState().session.signatureSnapshots ?? {})).toHaveLength(1);
  });

  it('binds apply previews to monotonic content revisions without counting view-only or rejected actions', () => {
    useSessionStore.getState().addDocuments([makeDocument('template'), makeDocument('target')]);
    useSessionStore.getState().addPlacement('template', { ...basePlacement });
    const revision = useSessionStore.getState().contentRevision;
    const preview = useSessionStore.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected preview');

    useSessionStore.getState().setSelection('target', null);
    useSessionStore.getState().updatePlacement('missing', 'missing', { x: 0.2 });
    expect(useSessionStore.getState().contentRevision).toBe(revision);

    useSessionStore.getState().addPlacement('target', { ...basePlacement, id: 'new-target' });
    expect(useSessionStore.getState().contentRevision).toBe(revision + 1);
    const before = useSessionStore.getState().session;
    expect(useSessionStore.getState().applyTemplatePlacements(preview)).toMatchObject({ ok: false, error: 'stale-preview' });
    expect(useSessionStore.getState().session).toBe(before);
  });

});
