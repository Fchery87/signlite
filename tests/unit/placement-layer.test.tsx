import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlacementLayer } from '../../src/components/editor/PlacementLayer';
import { PlacedElement } from '../../src/components/editor/PlacedElement';
import { useSessionStore } from '../../src/stores/session';
import { saveAsset, setDateFormat } from '../../src/db/signatures';

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
      templatePlacements: [],
      signatureSnapshots: {}
    },
    selectedDocumentId: 'doc-1',
    selectedPlacementId: null,
    copiedPlacement: null,
    history: { past: [], future: [] },
    view: 'editor'
  });
}

describe('placement layer', () => {
  beforeEach(async () => {
    resetStore();
    await setDateFormat('MMM d, yyyy');
  });

  it('creates placements from library drops only after the snapshot is available', async () => {
    const savedAsset = await saveAsset({
      kind: 'signature', source: 'uploaded', pngBytes: new Uint8Array([1, 2, 3]).buffer,
      width: 400, height: 100, label: 'Drop asset'
    });
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
      getData: () => JSON.stringify({ id: savedAsset.id, kind: 'signature', width: 400, height: 100 }),
      dropEffect: 'copy'
    };

    fireEvent.drop(layer, { dataTransfer, clientX: 100, clientY: 50 });

    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(0);
    await waitFor(() => expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(1));
    const placement = useSessionStore.getState().session.documents[0]?.placements[0];
    expect(placement).toMatchObject({ type: 'signature', pageIndex: 0, snapshotId: expect.any(String) });
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

  it('offers duplicate, copy, and delete on any selected element', () => {
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'sig-1',
      type: 'signature',
      assetId: 'asset-1',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    });
    const placement = useSessionStore.getState().session.documents[0]?.placements[0];

    render(<PlacedElement documentId="doc-1" pageSize={{ w: 200, h: 100 }} placement={placement!} scale={1} selected />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(useSessionStore.getState().copiedPlacement?.id).toBe('sig-1');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useSessionStore.getState().session.documents[0]?.placements.map((item) => item.id)).not.toContain('sig-1');
  });

  it('copies and duplicates the selected placement from the keyboard', () => {
    useSessionStore.getState().addPlacement('doc-1', {
      id: 'sig-1',
      type: 'signature',
      assetId: 'asset-1',
      pageIndex: 0,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1
    });

    render(
      <div className="relative" style={{ width: 200, height: 100 }}>
        <PlacementLayer
          documentId="doc-1"
          pageIndex={0}
          pageSize={{ w: 200, h: 100 }}
          placements={useSessionStore.getState().session.documents[0]?.placements ?? []}
          scale={1}
          selectedPlacementId="sig-1"
        />
      </div>
    );

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(useSessionStore.getState().copiedPlacement?.id).toBe('sig-1');

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(useSessionStore.getState().session.documents[0]?.placements).toHaveLength(2);
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

  it('renders a snapshot-backed placement exclusively from the Work Session', async () => {
    const snapshotBytes = new Uint8Array([42, 43, 44, 45, 46]).buffer;
    const libraryBytes = new Uint8Array([1, 2, 3]).buffer;
    const savedAsset = await saveAsset({
      kind: 'signature',
      source: 'uploaded',
      pngBytes: libraryBytes,
      width: 400,
      height: 100,
      label: 'Library sig'
    });

    // A snapshot-backed placement that also carries a legacy assetId.
    // Rendering must use the snapshot bytes, not the library asset.
    useSessionStore.setState((state) => ({
      session: {
        ...state.session,
        signatureSnapshots: {
          'snap-render': { id: 'snap-render', kind: 'signature', pngBytes: snapshotBytes, width: 400, height: 100 }
        },
        documents: state.session.documents.map((doc) =>
          doc.docId === 'doc-1'
            ? {
                ...doc,
                placements: [
                  ...doc.placements,
                  {
                    id: 'render-test',
                    type: 'signature',
                    snapshotId: 'snap-render',
                    assetId: savedAsset.id,
                    pageIndex: 0,
                    x: 0.1,
                    y: 0.1,
                    w: 0.2,
                    h: 0.1
                  }
                ]
              }
            : doc
        )
      }
    }));

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');
    const placement = useSessionStore.getState().session.documents[0]?.placements[0];
    if (!placement) throw new Error('Expected placement to exist');
    render(
      <PlacedElement documentId="doc-1" pageSize={{ w: 200, h: 100 }} placement={placement} scale={1} selected />
    );

    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', expect.any(String)));

    // The blob passed to createObjectURL must contain snapshot bytes, not library bytes.
    const blob = createObjectURLSpy.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.size).toBe(5);

    createObjectURLSpy.mockRestore();
  });
});
