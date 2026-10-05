import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '../../src/components/editor/EditorView';
import { sessionStoreTestHarness } from '../../src/stores/session';
import { STRINGS } from '../../src/lib/strings';
import { Modal } from '../../src/components/ui';

vi.mock('../../src/pdf/render', () => ({
  loadDocument: vi.fn(async () => ({ destroy: vi.fn() })),
  startPageRender: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn(async () => undefined) })),
  releaseThumbnails: vi.fn(async () => undefined),
  renderThumbnail: vi.fn(async () => { throw new Error('no canvas in jsdom'); })
}));
vi.mock('../../src/pdf/flatten', () => ({ flattenDocument: vi.fn() }));

class FakeIntersectionObserver {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
}
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }

/** A document with two signature placements already on page 1. */
function seedStoreWithTwoPlacements() {
  const placement = (id: string) => ({
    id, type: 'signature' as const, pageIndex: 0,
    x: 0.1, y: 0.1, w: 0.2, h: 0.1, snapshotId: 'snap-1'
  });
  sessionStoreTestHarness.setState({
    session: {
      id: 'session-1', createdAt: 1, updatedAt: 1,
      documents: [{
        docId: 'doc-1', fileName: 'lease.pdf', pdfBytes: new ArrayBuffer(8),
        pageCount: 1, pageSizes: [{ w: 200, h: 100 }],
        placements: [placement('p1'), placement('p2')], status: 'placed'
      }],
      templatePlacements: [],
      signatureSnapshots: {
        'snap-1': { id: 'snap-1', kind: 'signature', pngBytes: new ArrayBuffer(4), width: 10, height: 5 }
      }
    },
    selectedDocumentId: 'doc-1',
    selectedPlacementId: null,
    copiedPlacement: null,
    // Undo stack as it would look after placing each signature.
    history: {
      past: [
        { documents: [{
          docId: 'doc-1', fileName: 'lease.pdf', pdfBytes: new ArrayBuffer(8), pageCount: 1,
          pageSizes: [{ w: 200, h: 100 }], placements: [], status: 'pending' as const
        }], templatePlacements: [], at: 1 },
        { documents: [{
          docId: 'doc-1', fileName: 'lease.pdf', pdfBytes: new ArrayBuffer(8), pageCount: 1,
          pageSizes: [{ w: 200, h: 100 }], placements: [placement('p1')], status: 'placed' as const
        }], templatePlacements: [], at: 2 }
      ],
      future: []
    },
    view: 'editor',
    mutationLease: null,
    mutationLock: null
  });
}

const downloadButton = () =>
  screen.getAllByRole('button').find((b) => b.textContent?.trim() === STRINGS.buttons.download)!;

const placementCount = () =>
  sessionStoreTestHarness.getState().session.documents[0].placements.length;

describe('editor shortcuts are scoped away from open dialogs', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    seedStoreWithTwoPlacements();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Ctrl+Z while a dialog is open leaves Work Session placements alone', async () => {
    render(
      <>
        <EditorView onToast={() => {}} />
        <Modal open title="Draw signature" onClose={() => {}}>
          <canvas data-testid="pad" />
        </Modal>
      </>
    );
    await waitFor(() => expect(downloadButton()).toBeTruthy());
    expect(placementCount()).toBe(2);

    // The user means "undo my last pen stroke" -- a canvas is not an editable
    // target, so before the fix this undid the document instead.
    const pad = screen.getByTestId('pad');
    fireEvent.keyDown(pad, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(pad, { key: 'z', ctrlKey: true });

    expect(placementCount()).toBe(2);
    expect(downloadButton()).not.toBeDisabled();
  });

  it('Ctrl+S while a dialog is open does not download the document', async () => {
    const { flattenDocument } = await import('../../src/pdf/flatten');
    render(
      <>
        <EditorView onToast={() => {}} />
        <Modal open title="Draw signature" onClose={() => {}}>
          <canvas data-testid="pad" />
        </Modal>
      </>
    );
    await waitFor(() => expect(downloadButton()).toBeTruthy());

    fireEvent.keyDown(screen.getByTestId('pad'), { key: 's', ctrlKey: true });
    expect(flattenDocument).not.toHaveBeenCalled();
  });

  it('with no dialog open the editor shortcuts still work', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(downloadButton()).toBeTruthy());
    expect(placementCount()).toBe(2);

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(placementCount()).toBe(1));

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(placementCount()).toBe(0));
    await waitFor(() => expect(downloadButton()).toBeDisabled());
    expect(downloadButton().getAttribute('title')).toBe(STRINGS.tooltips.nothingPlacedYet);
  });

  it('a text input is still shielded from the same shortcut', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(downloadButton()).toBeTruthy());

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(placementCount()).toBe(2);
  });
});
