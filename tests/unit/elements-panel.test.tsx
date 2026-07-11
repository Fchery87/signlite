import { fireEvent, render, screen } from '@testing-library/react';
import { ElementsPanel } from '../../src/components/editor/ElementsPanel';
import { sessionStoreTestHarness } from '../../src/stores/session';

function resetStore() {
  sessionStoreTestHarness.setState({
    session: {
      id: 'session-1',
      createdAt: 1,
      updatedAt: 1,
      documents: [
        {
          docId: 'doc-1',
          fileName: 'lease.pdf',
          pdfBytes: new ArrayBuffer(0),
          pageCount: 3,
          pageSizes: Array.from({ length: 3 }, () => ({ w: 200, h: 100 })),
          placements: [
            { id: 'sig-1', type: 'signature', assetId: 'asset-1', pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
            { id: 'text-1', type: 'text', pageIndex: 2, x: 0.1, y: 0.3, w: 0.3, h: 0.1, value: 'Signer name', fontSize: 12 }
          ],
          status: 'placed'
        }
      ],
      templatePlacements: []
    },
    selectedDocumentId: 'doc-1',
    selectedPlacementId: null,
    copiedPlacement: null,
    history: { past: [], future: [] },
    view: 'editor'
  });
}

describe('elements panel', () => {
  beforeEach(resetStore);

  it('lists placements with labels and page numbers', () => {
    const document = sessionStoreTestHarness.getState().session.documents[0]!;
    render(<ElementsPanel document={document} selectedPlacementId={null} onSelect={() => {}} />);

    expect(screen.getByText('Signature')).toBeInTheDocument();
    expect(screen.getByText('Text — Signer name')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByText('Page 3')).toBeInTheDocument();
  });

  it('selects an element when its row is clicked', () => {
    const document = sessionStoreTestHarness.getState().session.documents[0]!;
    const onSelect = vi.fn();
    render(<ElementsPanel document={document} selectedPlacementId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Text — Signer name'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'text-1', pageIndex: 2 }));
  });

  it('deletes an element from its row', () => {
    const document = sessionStoreTestHarness.getState().session.documents[0]!;
    render(<ElementsPanel document={document} selectedPlacementId={null} onSelect={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Signature on page 1' }));
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements.map((item) => item.id)).toEqual(['text-1']);
  });

  it('shows an empty state when nothing is placed', () => {
    const document = { ...sessionStoreTestHarness.getState().session.documents[0]!, placements: [] };
    render(<ElementsPanel document={document} selectedPlacementId={null} onSelect={() => {}} />);

    expect(screen.getByText('Nothing placed yet.')).toBeInTheDocument();
  });
});
