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
      templatePlacements: []
    },
    selectedDocumentId: null,
    selectedPlacementId: null,
    view: 'dropzone'
  });
}

describe('session store', () => {
  beforeEach(resetStore);

  it('adds documents and switches to editor view', () => {
    useSessionStore.getState().addDocuments([makeDocument('doc-1')]);

    const state = useSessionStore.getState();
    expect(state.view).toBe('editor');
    expect(state.session.documents).toHaveLength(1);
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
});
