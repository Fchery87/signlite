import { sessionStoreTestHarness } from '../../src/stores/session';

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
  sessionStoreTestHarness.setState({
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
    contentRevision: 0,
    mutationLease: null,
    mutationLock: null
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
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);

    const state = sessionStoreTestHarness.getState();
    expect(state.view).toBe('editor');
    expect(state.session.documents).toHaveLength(1);
  });

  it('atomically inserts and deduplicates immutable signature snapshots', async () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);
    const asset = {
      kind: 'signature' as const,
      pngBytes: new Uint8Array([1, 2, 3]).buffer,
      width: 20,
      height: 10
    };

    const first = await sessionStoreTestHarness.getState().addSignaturePlacement('doc-1', asset, {
      id: 'snapshot-placement-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1
    });
    const second = await sessionStoreTestHarness.getState().addSignaturePlacement('doc-1', asset, {
      id: 'snapshot-placement-2', pageIndex: 0, x: 0.2, y: 0.2, w: 0.2, h: 0.1
    });

    const session = sessionStoreTestHarness.getState().session;
    expect(first?.snapshotId).toBe(second?.snapshotId);
    expect(Object.keys(session.signatureSnapshots ?? {})).toHaveLength(1);
    expect(session.documents[0]?.placements.every((placement) => Boolean(placement.snapshotId))).toBe(true);
    expect(session.documents[0]?.placements.every((placement) => !placement.assetId && !placement.assetPngBytes)).toBe(true);
  });

  it('does not restore a document removed while a signature snapshot resolves', async () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);

    const pending = sessionStoreTestHarness.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([1, 2, 3]).buffer, width: 20, height: 10 },
      { id: 'racing-placement', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    );
    sessionStoreTestHarness.getState().removeDocument('doc-1');

    await expect(pending).resolves.toBeNull();
    expect(sessionStoreTestHarness.getState().session.documents).toHaveLength(0);
    expect(sessionStoreTestHarness.getState().session.signatureSnapshots).toEqual({});
  });

  it('does not apply stale signature work to replacement resources with the same document identity', async () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);
    const pending = sessionStoreTestHarness.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([4, 5, 6]).buffer, width: 20, height: 10 },
      { id: 'stale-placement', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    );

    sessionStoreTestHarness.setState((state) => ({
      session: {
        id: 'replacement-session', createdAt: 2, updatedAt: 2,
        documents: [makeDocument('doc-1')], templatePlacements: [], signatureSnapshots: {}
      },
      ownershipRevision: state.ownershipRevision + 1,
      history: { past: [], future: [] }
    }));

    await expect(pending).resolves.toBeNull();
    const state = sessionStoreTestHarness.getState();
    expect(state.session.id).toBe('replacement-session');
    expect(state.session.documents[0]?.placements).toEqual([]);
    expect(state.history).toEqual({ past: [], future: [] });
  });

  it('does not restore a normalized candidate after Start Fresh supersedes it', async () => {
    const pending = sessionStoreTestHarness.getState().restoreSession({
      id: 'saved-session', createdAt: 2, updatedAt: 2,
      documents: [makeDocument('doc-1')], templatePlacements: [], signatureSnapshots: {}
    });
    sessionStoreTestHarness.getState().resetSession();

    await expect(pending).resolves.toBe(false);
    expect(sessionStoreTestHarness.getState().session.id).not.toBe('saved-session');
    expect(sessionStoreTestHarness.getState().session.documents).toEqual([]);
  });

  it('retains snapshots after placement deletion and undo history changes', async () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);
    await sessionStoreTestHarness.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'initials', pngBytes: new Uint8Array([8]).buffer, width: 2, height: 1 },
      { id: 'snap-placement', pageIndex: 0, x: 0, y: 0, w: 0.2, h: 0.1 }
    );
    const snapshotId = sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.snapshotId;
    sessionStoreTestHarness.getState().removePlacement('doc-1', 'snap-placement');
    expect(sessionStoreTestHarness.getState().session.signatureSnapshots?.[snapshotId!]).toBeDefined();
    sessionStoreTestHarness.getState().undo();
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.snapshotId).toBe(snapshotId);
  });

  it('reorders documents and keeps the first doc as the template source', () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1'), makeDocument('doc-2')]);
    sessionStoreTestHarness.getState().addTextPlacement('doc-2', {
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

    sessionStoreTestHarness.getState().reorderDocuments(['doc-2', 'doc-1']);

    const state = sessionStoreTestHarness.getState();
    expect(state.session.documents.map((document) => document.docId)).toEqual(['doc-2', 'doc-1']);
    expect(state.session.templatePlacements).toHaveLength(1);
    expect(state.session.templatePlacements[0]?.value).toBe('Template text');
  });

  it('applies template placements to compatible docs and flags mismatches', () => {
    sessionStoreTestHarness.getState().addDocuments([
      makeDocument('template', 2),
      makeDocument('doc-2', 2),
      makeDocument('doc-3', 1),
      makeDocument('doc-4', 2, { w: 792, h: 612 })
    ]);
    sessionStoreTestHarness.getState().addTextPlacement('template', {
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

    const preview = sessionStoreTestHarness.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected preview');
    const result = sessionStoreTestHarness.getState().applyTemplatePlacements(preview);
    const documents = sessionStoreTestHarness.getState().session.documents;

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
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);
    expect(sessionStoreTestHarness.getState().pastePlacement('doc-1', 0)).toBeNull();
  });

  it('undoes and redoes placement changes', () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);
    sessionStoreTestHarness.getState().addTextPlacement('doc-1', { ...basePlacement });
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(1);

    sessionStoreTestHarness.getState().undo();
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(0);
    expect(sessionStoreTestHarness.getState().selectedPlacementId).toBeNull();

    sessionStoreTestHarness.getState().redo();
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(1);
  });

  it('clears history and clipboard when documents change', () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1')]);
    sessionStoreTestHarness.getState().addTextPlacement('doc-1', { ...basePlacement });
    sessionStoreTestHarness.getState().copyPlacement('doc-1', 'placement-1');

    sessionStoreTestHarness.getState().removeDocument('doc-1');

    const state = sessionStoreTestHarness.getState();
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
    expect(state.copiedPlacement).toBeNull();
    state.undo();
    expect(sessionStoreTestHarness.getState().session.documents).toHaveLength(0);
  });

  it('preserves snapshot references through duplicate, copy, and paste', async () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1', 2)]);
    await sessionStoreTestHarness.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([10, 20, 30]).buffer, width: 40, height: 20 },
      { id: 'snap-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
    );
    const originalSnapshotId = sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.snapshotId;

    sessionStoreTestHarness.getState().duplicatePlacement('doc-1', 'snap-1');
    const afterDup = sessionStoreTestHarness.getState().session.documents[0]?.placements ?? [];
    expect(afterDup[1]?.snapshotId).toBe(originalSnapshotId);
    expect(afterDup[1]?.id).not.toBe('snap-1');

    sessionStoreTestHarness.getState().copyPlacement('doc-1', 'snap-1');
    expect(sessionStoreTestHarness.getState().copiedPlacement?.snapshotId).toBe(originalSnapshotId);

    const pasted = sessionStoreTestHarness.getState().pastePlacement('doc-1', 1);
    expect(pasted?.snapshotId).toBe(originalSnapshotId);
    expect(pasted?.pageIndex).toBe(1);

    // The snapshot pool still holds exactly one entry for all three placements.
    expect(Object.keys(sessionStoreTestHarness.getState().session.signatureSnapshots ?? {})).toHaveLength(1);
  });

  it('preserves snapshot references through template application', async () => {
    sessionStoreTestHarness.getState().addDocuments([
      makeDocument('template', 2),
      makeDocument('doc-2', 2)
    ]);
    await sessionStoreTestHarness.getState().addSignaturePlacement(
      'template',
      { kind: 'signature', pngBytes: new Uint8Array([5, 6, 7]).buffer, width: 30, height: 10 },
      { id: 'tmpl-snap', pageIndex: 1, x: 0.1, y: 0.1, w: 0.25, h: 0.1 }
    );
    const originalSnapshotId = sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.snapshotId;

    const preview = sessionStoreTestHarness.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected preview');
    const result = sessionStoreTestHarness.getState().applyTemplatePlacements(preview);
    expect(result.appliedDocIds).toEqual(['doc-2']);

    const targetPlacements = sessionStoreTestHarness.getState().session.documents[1]?.placements ?? [];
    expect(targetPlacements[0]?.snapshotId).toBe(originalSnapshotId);
    expect(targetPlacements[0]?.id).not.toBe('tmpl-snap');

    // The snapshot pool is shared, not duplicated.
    expect(Object.keys(sessionStoreTestHarness.getState().session.signatureSnapshots ?? {})).toHaveLength(1);
  });

  it('binds apply previews to monotonic content revisions without counting view-only or rejected actions', () => {
    sessionStoreTestHarness.getState().addDocuments([makeDocument('template'), makeDocument('target')]);
    sessionStoreTestHarness.getState().addTextPlacement('template', { ...basePlacement });
    const revision = sessionStoreTestHarness.getState().contentRevision;
    const preview = sessionStoreTestHarness.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected preview');

    sessionStoreTestHarness.getState().setSelection('target', null);
    sessionStoreTestHarness.getState().updatePlacement('missing', 'missing', { x: 0.2 });
    expect(sessionStoreTestHarness.getState().contentRevision).toBe(revision);

    sessionStoreTestHarness.getState().addTextPlacement('target', { ...basePlacement, id: 'new-target' });
    expect(sessionStoreTestHarness.getState().contentRevision).toBe(revision + 1);
    const before = sessionStoreTestHarness.getState().session;
    expect(sessionStoreTestHarness.getState().applyTemplatePlacements(preview)).toMatchObject({ ok: false, error: 'stale-preview' });
    expect(sessionStoreTestHarness.getState().session).toBe(before);
  });


  it('owns an exclusive identified lease and rejects wrong or stale capabilities', () => {
    const first = sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt-1');
    expect(first).not.toBeNull();
    if (!first) return;
    expect(first.owner).toBe('Batch Signing attempt-1');
    expect(sessionStoreTestHarness.getState().mutationLock).toEqual({ owner: 'Batch Signing attempt-1' });
    expect(sessionStoreTestHarness.getState().mutationLock).not.toHaveProperty('id');
    expect(sessionStoreTestHarness.getState().acquireMutationLease('another owner')).toBeNull();

    expect(sessionStoreTestHarness.getState().releaseMutationLease({ ...first })).toBe(false);
    expect(sessionStoreTestHarness.getState().mutationLock).not.toBeNull();
    expect(sessionStoreTestHarness.getState().releaseMutationLease(first)).toBe(true);
    expect(sessionStoreTestHarness.getState().mutationLock).toBeNull();

    const second = sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt-2');
    expect(second).not.toBeNull();
    expect(sessionStoreTestHarness.getState().releaseMutationLease(first)).toBe(false);
    expect(sessionStoreTestHarness.getState().mutationLock).toEqual({ owner: 'Batch Signing attempt-2' });
    if (second) expect(sessionStoreTestHarness.getState().releaseMutationLease(second)).toBe(true);
  });

  it('rejects every durable action category while leased but permits read navigation', async () => {
    const first = { ...basePlacement };
    const second = { ...basePlacement, id: 'placement-2', value: 'Target' };
    sessionStoreTestHarness.getState().addDocuments([makeDocument('doc-1'), makeDocument('doc-2')]);
    sessionStoreTestHarness.getState().addTextPlacement('doc-1', first);
    sessionStoreTestHarness.getState().addTextPlacement('doc-2', second);
    sessionStoreTestHarness.getState().copyPlacement('doc-1', first.id);
    const preview = sessionStoreTestHarness.getState().previewApplyTemplatePlacements();
    if (!preview) throw new Error('Expected apply preview');

    const pendingSignature = sessionStoreTestHarness.getState().addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([9, 8, 7]).buffer, width: 20, height: 10 },
      { id: 'pre-lock-signature', pageIndex: 0, x: 0.4, y: 0.4, w: 0.2, h: 0.1 }
    );
    const lease = sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt');
    if (!lease) throw new Error('Expected lease');
    const baseline = sessionStoreTestHarness.getState();
    const candidate = {
      id: 'restore-candidate', createdAt: 2, updatedAt: 2,
      documents: [makeDocument('restored')], templatePlacements: [], signatureSnapshots: {}
    };

    baseline.addDocuments([makeDocument('doc-3')]);
    baseline.removeDocument('doc-2');
    baseline.reorderDocuments(['doc-2', 'doc-1']);
    baseline.addTextPlacement('doc-1', { ...basePlacement, id: 'blocked-add' });
    await expect(baseline.addSignaturePlacement(
      'doc-1',
      { kind: 'signature', pngBytes: new Uint8Array([1]).buffer, width: 1, height: 1 },
      { id: 'blocked-signature', pageIndex: 0, x: 0, y: 0, w: 0.2, h: 0.1 }
    )).resolves.toBeNull();
    baseline.updatePlacement('doc-1', first.id, { x: 0.2 });
    baseline.removePlacement('doc-1', first.id);
    baseline.duplicatePlacement('doc-1', first.id);
    expect(baseline.pastePlacement('doc-1', 0)).toBeNull();
    baseline.undo();
    baseline.redo();
    expect(baseline.applyTemplatePlacements(preview)).toMatchObject({ ok: false, error: 'rejected' });
    expect(baseline.transitionDocumentOutput('doc-1', 'signing')).toBe(false);
    await expect(baseline.restoreSession(candidate)).resolves.toBe(false);
    baseline.resetSession();
    await expect(pendingSignature).resolves.toBeNull();

    const locked = sessionStoreTestHarness.getState();
    expect(locked.session).toBe(baseline.session);
    expect(locked.history).toBe(baseline.history);
    expect(locked.contentRevision).toBe(baseline.contentRevision);
    expect(locked.ownershipRevision).toBe(baseline.ownershipRevision);

    locked.setSelection('doc-2', null);
    expect(sessionStoreTestHarness.getState().selectedDocumentId).toBe('doc-2');
    expect(sessionStoreTestHarness.getState().contentRevision).toBe(baseline.contentRevision);
    expect(sessionStoreTestHarness.getState().ownershipRevision).toBe(baseline.ownershipRevision);

    expect(sessionStoreTestHarness.getState().transitionDocumentOutput('doc-1', 'signing', undefined, lease)).toBe(true);
    expect(sessionStoreTestHarness.getState().session.documents[0]?.status).toBe('signing');
    expect(sessionStoreTestHarness.getState().releaseMutationLease(lease)).toBe(true);
  });

});
