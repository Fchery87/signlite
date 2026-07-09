import { fireEvent, render, screen } from '@testing-library/react';
import { PlacementLayer } from '../../src/components/editor/PlacementLayer';
import { PlacedElement } from '../../src/components/editor/PlacedElement';
import { useSessionStore } from '../../src/stores/session';
import { setDateFormat } from '../../src/db/signatures';

function resetStore() {
  useSessionStore.setState({
    session: {
      id: 'session-1',
      createdAt: 1,
      updatedAt: 1,
      documents: [
        {
          docId: 'doc-1',
          fileName: 'lease.pdf',
          pdfBytes: new ArrayBuffer(0),
          pageCount: 1,
          pageSizes: [{ w: 200, h: 100 }],
          placements: [],
          status: 'pending'
        }
      ],
      templatePlacements: []
    },
    selectedDocumentId: 'doc-1',
    selectedPlacementId: null,
    view: 'editor'
  });
}

describe('placement layer', () => {
  beforeEach(async () => {
    resetStore();
    await setDateFormat('MMM d, yyyy');
  });

  it('creates placements from library drops', () => {
    const { getByTestId } = render(
      <div className="relative" style={{ width: 200, height: 100 }}>
        <PlacementLayer
          documentId="doc-1"
          pageIndex={0}
          pageSize={{ w: 200, h: 100 }}
          placements={[]}
          scale={1}
          selectedPlacementId={null}
        />
      </div>
    );

    const layer = getByTestId('placement-layer');
    Object.defineProperty(layer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 })
    });

    const dataTransfer = {
      getData: () => JSON.stringify({ id: 'asset-1', kind: 'signature', width: 400, height: 100 }),
      dropEffect: 'copy'
    };

    fireEvent.drop(layer, { dataTransfer, clientX: 100, clientY: 50 });

    const placement = useSessionStore.getState().session.documents[0]?.placements[0];
    expect(placement).toMatchObject({ type: 'signature', pageIndex: 0 });
    expect(placement?.w).toBeCloseTo(0.2);
    expect(placement?.h).toBeCloseTo(0.24);
  });

  it('nudges, deselects, and deletes selected placements from the keyboard', () => {
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'placement-1',
      type: 'signature',
      assetId: 'asset-1',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    });

    const { rerender } = render(
      <div className="relative" style={{ width: 200, height: 100 }}>
        <PlacementLayer
          documentId="doc-1"
          pageIndex={0}
          pageSize={{ w: 200, h: 100 }}
          placements={useSessionStore.getState().session.documents[0]?.placements ?? []}
          scale={1}
          selectedPlacementId={null}
        />
      </div>
    );

    const placement = useSessionStore.getState().session.documents[0]?.placements[0];
    rerender(
      <div className="relative" style={{ width: 200, height: 100 }}>
        <PlacementLayer
          documentId="doc-1"
          pageIndex={0}
          pageSize={{ w: 200, h: 100 }}
          placements={useSessionStore.getState().session.documents[0]?.placements ?? []}
          scale={1}
          selectedPlacementId={placement?.id ?? null}
        />
      </div>
    );

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useSessionStore.getState().session.documents[0]?.placements[0]?.x).toBeCloseTo(0.1 + 1 / 200);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSessionStore.getState().selectedPlacementId).toBeNull();

    useSessionStore.getState().setSelection('doc-1', placement?.id ?? null);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(0);
  });

  it('ignores placement shortcuts while an input is focused', () => {
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'placement-1',
      type: 'signature',
      assetId: 'asset-1',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    });

    render(
      <>
        <input aria-label="Rename asset" defaultValue="Signer" />
        <div className="relative" style={{ width: 200, height: 100 }}>
          <PlacementLayer
            documentId="doc-1"
            pageIndex={0}
            pageSize={{ w: 200, h: 100 }}
            placements={useSessionStore.getState().session.documents[0]?.placements ?? []}
            scale={1}
            selectedPlacementId="placement-1"
          />
        </div>
      </>
    );

    const input = screen.getByLabelText('Rename asset');
    input.focus();

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'Delete' });

    const placement = useSessionStore.getState().session.documents[0]?.placements[0];
    expect(placement?.x).toBeCloseTo(0.1);
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(1);
  });

  it('cycles date formats and edits text placements inline', () => {
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'date-1',
      type: 'date',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1,
      value: 'MMM d, yyyy',
      fontSize: 12
    });
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'text-1',
      type: 'text',
      pageIndex: 0,
      x: 0.1,
      y: 0.3,
      w: 0.3,
      h: 0.1,
      value: 'Text',
      fontSize: 12
    });

    const placements = useSessionStore.getState().session.documents[0]?.placements ?? [];
    const datePlacement = placements.find((item) => item.id === 'date-1');
    const textPlacement = placements.find((item) => item.id === 'text-1');
    if (!datePlacement || !textPlacement) {
      throw new Error('Expected placements to exist');
    }

    render(
      <div>
        <PlacedElement documentId="doc-1" pageSize={{ w: 200, h: 100 }} placement={datePlacement} scale={1} selected />
        <PlacedElement documentId="doc-1" pageSize={{ w: 200, h: 100 }} placement={textPlacement} scale={1} selected />
      </div>
    );

    fireEvent.click(screen.getByText('Cycle format'));
    expect(useSessionStore.getState().session.documents[0]?.placements.find((item) => item.id === 'date-1')?.value).toBe('MM/dd/yyyy');

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByDisplayValue('Text');
    fireEvent.change(input, { target: { value: 'Signer name' } });
    expect(useSessionStore.getState().session.documents[0]?.placements.find((item) => item.id === 'text-1')?.value).toBe('Signer name');

    // Both the date and text placements render a size input; the text one is second.
    const sizeInput = screen.getAllByRole('spinbutton')[1]!;
    fireEvent.change(sizeInput, { target: { value: '18' } });
    expect(useSessionStore.getState().session.documents[0]?.placements.find((item) => item.id === 'text-1')?.fontSize).toBe(18);
  });

  it('adjusts date font size from the toolbar without starting a drag', () => {
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'date-1',
      type: 'date',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1,
      value: 'MMM d, yyyy',
      fontSize: 12
    });

    const datePlacement = useSessionStore.getState().session.documents[0]?.placements[0];
    if (!datePlacement) {
      throw new Error('Expected placement to exist');
    }

    render(<PlacedElement documentId="doc-1" pageSize={{ w: 200, h: 100 }} placement={datePlacement} scale={1} selected />);

    const sizeInput = screen.getByRole('spinbutton');

    // Pointer-down on the size input must not be captured by the move-drag
    // handler, which would preventDefault and block focusing the input.
    const notPrevented = fireEvent.pointerDown(sizeInput, { pointerId: 1 });
    expect(notPrevented).toBe(true);

    fireEvent.change(sizeInput, { target: { value: '16' } });
    expect(useSessionStore.getState().session.documents[0]?.placements[0]?.fontSize).toBe(16);
    expect(useSessionStore.getState().session.documents[0]?.placements[0]?.value).toBe('MMM d, yyyy');
  });
});
