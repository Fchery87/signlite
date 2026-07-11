import {
  addDocuments,
  addSignaturePlacement,
  addTextPlacement,
  copyPlacement,
  duplicatePlacement,
  emptyHistory,
  pastePlacement,
  removeDocument,
  removePlacement,
  redo,
  reorderDocuments,
  replaceSession,
  undo,
  updatePlacement
} from '../../src/lib/workSessionEditor';
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

  it('adds only validated text/date Placements', () => {
    const session = makeSession([makeDoc('doc-1')]);
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };

    const added = addTextPlacement(session, emptyHistory(), { docId: 'doc-1', placement: text });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.session.documents[0]?.placements[0]).toEqual(text);
    expect(added.selectedPlacementId).toBe(text.id);
    expect(added.history.past).toHaveLength(1);

    const unsupported = addTextPlacement(session, emptyHistory(), {
      docId: 'doc-1',
      placement: { ...PLACEMENT_INPUT, type: 'signature' }
    });
    expect(unsupported.ok).toBe(false);

    const invalidFont = addTextPlacement(session, emptyHistory(), {
      docId: 'doc-1',
      placement: { ...text, fontSize: 100 }
    });
    expect(invalidFont.ok).toBe(false);
  });

  it('coalesces typing into one undo action inside WorkSessionEditor', () => {
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
    const session = makeSession([{ ...makeDoc('doc-1'), placements: [text] }]);

    const first = updatePlacement(session, emptyHistory(), {
      docId: 'doc-1', placementId: text.id, changes: { value: 'H' }, coalesceKey: `text:${text.id}`
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = updatePlacement(first.session, first.history, {
      docId: 'doc-1', placementId: text.id, changes: { value: 'Hi' }, coalesceKey: `text:${text.id}`
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.history.past).toHaveLength(1);

    const reversed = undo(second.session, second.history);
    expect(reversed.session.documents[0]?.placements[0]?.value).toBe('');
  });

  it('keeps a long pointer gesture to one undo entry', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
      const session = makeSession([{ ...makeDoc('doc-1'), placements: [text] }]);
      const key = 'gesture-placement-1';

      const first = updatePlacement(session, emptyHistory(), {
        docId: 'doc-1', placementId: text.id, changes: { x: 0.2 }, coalesceKey: key, historyMode: 'gesture'
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      vi.advanceTimersByTime(5000);
      const second = updatePlacement(first.session, first.history, {
        docId: 'doc-1', placementId: text.id, changes: { x: 0.3 }, coalesceKey: key, historyMode: 'gesture'
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.history.past).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid committed update without changing state or history', () => {
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
    const session = makeSession([{ ...makeDoc('doc-1'), placements: [text] }]);
    const history = emptyHistory();

    const result = updatePlacement(session, history, {
      docId: 'doc-1', placementId: text.id, changes: { x: Number.NaN }
    });
    expect(result.ok).toBe(false);
    expect(session.updatedAt).toBe(1);
    expect(session.documents[0]?.placements[0]?.x).toBe(0.1);
    expect(history.past).toHaveLength(0);
  });

  it('removes, duplicates, copies, and pastes with complete consequences', async () => {
    const seeded = await addSignaturePlacement(makeSession([makeDoc('doc-1', 2)]), emptyHistory(), {
      docId: 'doc-1', asset: ASSET, placement: PLACEMENT_INPUT
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const snapshotId = seeded.placement.snapshotId;

    const duplicated = duplicatePlacement(seeded.session, emptyHistory(), 'doc-1', seeded.placement.id);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    const clone = duplicated.session.documents[0]?.placements[1];
    expect(clone?.id).not.toBe(seeded.placement.id);
    expect(clone?.snapshotId).toBe(snapshotId);
    expect(duplicated.selectedPlacementId).toBe(clone?.id);

    const copied = copyPlacement(seeded.session, 'doc-1', seeded.placement.id);
    const pasted = pastePlacement(seeded.session, emptyHistory(), 'doc-1', 1, copied);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const paste = pasted.session.documents[0]?.placements[1];
    expect(paste?.id).not.toBe(seeded.placement.id);
    expect(paste?.pageIndex).toBe(1);
    expect(paste?.snapshotId).toBe(snapshotId);

    const removed = removePlacement(seeded.session, emptyHistory(), 'doc-1', seeded.placement.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.session.documents[0]?.placements).toHaveLength(0);
    expect(removed.session.documents[0]?.status).toBe('pending');
    expect(removed.selectedPlacementId).toBeNull();
    expect(removed.history.past).toHaveLength(1);
  });

  it('rejects duplicate and paste when a required snapshot is missing', () => {
    const broken = { ...PLACEMENT_INPUT, type: 'signature' as const, snapshotId: 'missing' };
    const session = makeSession([{ ...makeDoc('doc-1'), placements: [broken] }]);

    expect(duplicatePlacement(session, emptyHistory(), 'doc-1', broken.id)).toMatchObject({
      ok: false, error: { reason: 'missing-snapshot' }
    });
    expect(pastePlacement(session, emptyHistory(), 'doc-1', 0, broken)).toMatchObject({
      ok: false, error: { reason: 'missing-snapshot' }
    });
    expect(session.documents[0]?.placements).toHaveLength(1);
  });


  it('rejects duplicate Placement identities without changing state', () => {
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
    const session = makeSession([{ ...makeDoc('doc-1'), placements: [text] }]);

    const result = addTextPlacement(session, emptyHistory(), { docId: 'doc-1', placement: { ...text } });
    expect(result).toMatchObject({ ok: false, error: { reason: 'duplicate-placement-id' } });
    expect(session.documents[0]?.placements).toHaveLength(1);
  });

  it('preserves selection when undo has no history and repairs it when restoring state', () => {
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
    const session = makeSession([{ ...makeDoc('doc-1'), placements: [text] }]);

    const noOp = undo(session, emptyHistory(), text.id);
    expect(noOp.changed).toBe(false);
    expect(noOp.selectedPlacementId).toBe(text.id);

    const removed = removePlacement(session, emptyHistory(), 'doc-1', text.id);
    if (!removed.ok) throw new Error('expected removal');
    const restored = undo(removed.session, removed.history, null);
    expect(restored.changed).toBe(true);
    expect(restored.session.documents[0]?.placements[0]?.id).toBe(text.id);
  });


  it('clears redo and records a new undo point when editing after undo', () => {
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
    const session = makeSession([{ ...makeDoc('doc-1'), placements: [text] }]);
    const first = updatePlacement(session, emptyHistory(), {
      docId: 'doc-1', placementId: text.id, changes: { value: 'A' }, coalesceKey: `text:${text.id}`
    });
    if (!first.ok) throw new Error('expected update');
    const duplicated = duplicatePlacement(first.session, first.history, 'doc-1', text.id);
    if (!duplicated.ok) throw new Error('expected duplicate');
    const reversed = undo(duplicated.session, duplicated.history, text.id);
    expect(reversed.history.future).toHaveLength(1);

    const branched = updatePlacement(reversed.session, reversed.history, {
      docId: 'doc-1', placementId: text.id, changes: { value: 'B' }, coalesceKey: `text:${text.id}`
    });
    expect(branched.ok).toBe(true);
    if (!branched.ok) return;
    expect(branched.history.future).toHaveLength(0);
    expect(branched.history.past).toHaveLength(2);
    expect(undo(branched.session, branched.history).session.documents[0]?.placements[0]?.value).toBe('A');
  });

  it('invalidates Signed state and clears stale errors on update and partial removal', () => {
    const first = { ...PLACEMENT_INPUT, id: 'first', type: 'text' as const, value: 'A', fontSize: 12 };
    const second = { ...PLACEMENT_INPUT, id: 'second', x: 0.4, type: 'text' as const, value: 'B', fontSize: 12 };
    const signed = makeSession([{
      ...makeDoc('doc-1'), placements: [first, second], status: 'signed', batchError: 'stale'
    }]);

    const updated = updatePlacement(signed, emptyHistory(), {
      docId: 'doc-1', placementId: first.id, changes: { value: 'Changed' }
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.session.documents[0]).toMatchObject({ status: 'placed', batchError: undefined });

    const removed = removePlacement(signed, emptyHistory(), 'doc-1', first.id, second.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.session.documents[0]).toMatchObject({ status: 'placed', batchError: undefined });
    expect(removed.selectedPlacementId).toBe(second.id);
  });

  it('rejects fractional and non-finite page indices', () => {
    const text = { ...PLACEMENT_INPUT, type: 'text' as const, value: '', fontSize: 12 };
    const session = makeSession([makeDoc('doc-1')]);
    for (const pageIndex of [0.5, Number.NaN]) {
      const result = addTextPlacement(session, emptyHistory(), {
        docId: 'doc-1', placement: { ...text, pageIndex }
      });
      expect(result).toMatchObject({ ok: false, error: { reason: 'page-not-found' } });
    }
  });


  it('reorders an exact document permutation as one undoable action', () => {
    const template = { ...PLACEMENT_INPUT, type: 'text' as const, value: 'Second', fontSize: 12 };
    const session = makeSession([makeDoc('doc-1'), { ...makeDoc('doc-2'), placements: [template] }]);
    const state = {
      session, history: emptyHistory(), selectedDocumentId: 'doc-1',
      selectedPlacementId: null, copiedPlacement: null
    };

    const reordered = reorderDocuments(state, ['doc-2', 'doc-1']);
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(reordered.session.documents.map((doc) => doc.docId)).toEqual(['doc-2', 'doc-1']);
    expect(reordered.session.templatePlacements[0]?.value).toBe('Second');
    expect(reordered.history.past).toHaveLength(1);

    const reversed = undo(
      reordered.session, reordered.history, reordered.selectedPlacementId, reordered.selectedDocumentId
    );
    expect(reversed.session.documents.map((doc) => doc.docId)).toEqual(['doc-1', 'doc-2']);
    expect(reversed.session.templatePlacements).toEqual([]);
    const replayed = redo(
      reversed.session, reversed.history, reversed.selectedPlacementId, reversed.selectedDocumentId
    );
    expect(replayed.session.documents.map((doc) => doc.docId)).toEqual(['doc-2', 'doc-1']);
    expect(replayed.session.templatePlacements[0]?.value).toBe('Second');
  });

  it('rejects incomplete, duplicate, and unknown document orders atomically', () => {
    const session = makeSession([makeDoc('doc-1'), makeDoc('doc-2')]);
    const state = {
      session, history: emptyHistory(), selectedDocumentId: 'doc-1',
      selectedPlacementId: null, copiedPlacement: null
    };
    for (const order of [['doc-1'], ['doc-1', 'doc-1'], ['doc-1', 'missing']]) {
      const result = reorderDocuments(state, order);
      expect(result).toMatchObject({ ok: false, error: { reason: 'invalid-document-order' } });
      expect(session.documents.map((doc) => doc.docId)).toEqual(['doc-1', 'doc-2']);
      expect(state.history.past).toHaveLength(0);
    }
  });

  it('treats membership changes as history and clipboard barriers', () => {
    const placement = { ...PLACEMENT_INPUT, type: 'text' as const, value: 'A', fontSize: 12 };
    const first = { ...makeDoc('doc-1'), placements: [placement] };
    const priorHistory = { past: [{ documents: [first], templatePlacements: [placement], at: 2 }], future: [] };
    const state = {
      session: makeSession([first]), history: priorHistory, selectedDocumentId: 'doc-1',
      selectedPlacementId: placement.id, copiedPlacement: placement
    };

    const added = addDocuments(state, [makeDoc('doc-2')]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.history).toEqual(emptyHistory());
    expect(added.copiedPlacement).toBeNull();

    const removed = removeDocument({
      session: added.session,
      history: added.history,
      selectedDocumentId: added.selectedDocumentId,
      selectedPlacementId: added.selectedPlacementId,
      copiedPlacement: added.copiedPlacement
    }, 'doc-1');
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.session.documents.map((doc) => doc.docId)).toEqual(['doc-2']);
    expect(removed.history).toEqual(emptyHistory());
    expect(removed.selectedDocumentId).toBe('doc-2');
    expect(removed.selectedPlacementId).toBeNull();
    expect(undo(removed.session, removed.history).changed).toBe(false);
  });

  it('coherently replaces restored state and repairs the selection pair', () => {
    const stale = { ...PLACEMENT_INPUT, type: 'text' as const, value: 'stale', fontSize: 12 };
    const restoredPlacement = { ...stale, id: 'restored', value: 'fresh' };
    const restored = makeSession([{ ...makeDoc('restored-doc'), placements: [restoredPlacement] }]);
    restored.templatePlacements = [stale];
    restored.signatureSnapshots = undefined;
    const current = {
      session: makeSession([makeDoc('old-doc')]),
      history: { past: [{ documents: [makeDoc('older')], templatePlacements: [], at: 1 }], future: [] },
      selectedDocumentId: 'missing', selectedPlacementId: stale.id, copiedPlacement: stale
    };

    const result = replaceSession(current, restored);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.templatePlacements).toEqual([restoredPlacement]);
    expect(result.session.signatureSnapshots).toEqual({});
    expect(result.selectedDocumentId).toBe('restored-doc');
    expect(result.selectedPlacementId).toBeNull();
    expect(result.history).toEqual(emptyHistory());
    expect(result.copiedPlacement).toBeNull();
  });

});
