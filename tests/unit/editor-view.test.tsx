import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { EditorView } from '../../src/components/editor/EditorView';
import { sessionStoreTestHarness } from '../../src/stores/session';
import { STRINGS } from '../../src/lib/strings';
import { loadDocument } from '../../src/pdf/render';

vi.mock('../../src/pdf/render', () => ({
  loadDocument: vi.fn(async () => ({ destroy: vi.fn() })),
  startPageRender: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn(async () => undefined) })),
  releaseThumbnails: vi.fn(async () => undefined),
  // Thumbnails fall back to their error state in tests; jsdom has no canvas.
  renderThumbnail: vi.fn(async () => {
    throw new Error('thumbnails are not rendered in unit tests');
  })
}));

// Typography is covered by text-layout and flatten tests; the editor tests
// only need placements to render without loading the bundled font.
vi.mock('../../src/pdf/textLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/pdf/textLayout')>()),
  ensureTextFontFamily: vi.fn(async () => 'SignLite Text'),
  layoutText: vi.fn(async (text: string, options: { fontSize: number }) => ({
    lines: [{ text, widthPx: text.length * 6 }],
    lineHeightPx: options.fontSize * 1.2,
    firstBaselinePx: options.fontSize,
    clipped: false,
    truncated: false
  }))
}));

vi.mock('../../src/pdf/flatten', () => ({
  assertTextExportable: vi.fn(async () => undefined),
  flattenDocument: vi.fn()
}));

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
  options?: IntersectionObserverInit;
};

const intersectionObservers: ObserverRecord[] = [];

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    intersectionObservers.push({ callback, observer: this as unknown as IntersectionObserver, options });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Reports on-screen visibility for one page. Pages also own a padded
 *  pre-render observer (rootMargin set), which does not drive the active page. */
function emitVisibility(pageIndex: number, ratio: number) {
  const record = intersectionObservers.filter((entry) => entry.options?.rootMargin === undefined)[pageIndex];
  record?.callback(
    [{ intersectionRatio: ratio, isIntersecting: ratio > 0 } as IntersectionObserverEntry],
    record.observer
  );
}

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
          pdfBytes: new ArrayBuffer(8),
          pageCount: 2,
          pageSizes: [
            { w: 200, h: 100 },
            { w: 200, h: 100 }
          ],
          placements: [],
          status: 'pending'
        }
      ],
      templatePlacements: []
    },
    selectedDocumentId: 'doc-1',
    selectedPlacementId: null,
    copiedPlacement: null,
    history: { past: [], future: [] },
    view: 'editor',
    mutationLease: null,
    mutationLock: null
  });
}

describe('editor view', () => {
  it('provides bounded previous and next page navigation in a named toolbar', { timeout: 15000 }, async () => {
    render(<EditorView onToast={vi.fn()} />);
    expect(screen.getByRole('toolbar', { name: 'Document navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText(STRINGS.editor.pageOf(2, 2))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText(STRINGS.editor.pageOf(1, 2))).toBeInTheDocument();
  });

  it('explains how to start without covering the PDF canvas', () => {
    render(<EditorView onToast={vi.fn()} />);
    expect(screen.getByText('Choose a signature, initials, date or text to begin.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STRINGS.buttons.download })).toBeDisabled();
  });

  it('retries a failed document load without removing the document', async () => {
    vi.mocked(loadDocument).mockRejectedValueOnce(new Error('Cannot read this PDF'));
    render(<EditorView onToast={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot read this PDF');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(sessionStoreTestHarness.getState().session.documents).toHaveLength(1);
  });

  it('keeps download failures visible and preserves the signing work', async () => {
    const { flattenDocument } = await import('../../src/pdf/flatten');
    vi.mocked(flattenDocument).mockRejectedValueOnce(new Error('Unable to prepare the PDF'));
    render(<EditorView onToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));
    const download = screen.getByRole('button', { name: STRINGS.buttons.download });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to prepare the PDF');
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(1);
    expect(download).toBeEnabled();
  });

  it('opens phone tools as a dialog and returns to the page after adding text', { timeout: 15000 }, async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<EditorView onToast={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: STRINGS.editor.showLibrary })[0]!);
    expect(screen.getByRole('dialog', { name: STRINGS.library.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('explains the visual signature and restricted export policy before download', () => {
    resetStore();
    render(<EditorView onToast={vi.fn()} />);
    expect(screen.getByText(/Visual signatures, not certificate-backed digital signatures/)).toBeInTheDocument();
    expect(screen.getByText(/not comprehensive PDF sanitization/)).toBeInTheDocument();
  });

  beforeEach(() => {
    intersectionObservers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps placing elements on the active page after a previous placement', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    // Simulate the user scrolling so page 2 is the visible page.
    act(() => {
      emitVisibility(0, 0);
      emitVisibility(1, 1);
    });

    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.date }));

    const placements = sessionStoreTestHarness.getState().session.documents[0]?.placements ?? [];
    expect(placements).toHaveLength(2);
    expect(placements[0]?.pageIndex).toBe(1);
    expect(placements[1]?.pageIndex).toBe(1);
  });

  it('places elements on a clicked thumbnail page before scrolling arrives', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    // Click the page 2 thumbnail; no visibility change has happened yet.
    fireEvent.click(screen.getByRole('button', { name: /page 2/i }));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));

    // Scroll arrives at page 2, releasing the pin; then the user scrolls back to page 1.
    act(() => {
      emitVisibility(0, 0);
      emitVisibility(1, 1);
    });
    act(() => {
      emitVisibility(1, 0);
      emitVisibility(0, 1);
    });
    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.date }));

    const placements = sessionStoreTestHarness.getState().session.documents[0]?.placements ?? [];
    expect(placements).toHaveLength(2);
    expect(placements[0]?.pageIndex).toBe(1);
    expect(placements[1]?.pageIndex).toBe(0);
  });

  it('pastes a copied element onto the active page with Ctrl+V', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });

    act(() => {
      emitVisibility(0, 0);
      emitVisibility(1, 1);
    });
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    const placements = sessionStoreTestHarness.getState().session.documents[0]?.placements ?? [];
    expect(placements).toHaveLength(2);
    expect(placements[1]?.pageIndex).toBe(1);
    expect(placements[1]?.id).not.toBe(placements[0]?.id);
  });

  it('undoes and redoes placement changes from the header buttons', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.undo }));
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.redo }));
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements).toHaveLength(1);
  });

  it('lets the user type more than one character into a text placement', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));
    sessionStoreTestHarness.setState({ history: { past: [], future: [] } });

    const placedButton = await within(screen.getAllByTestId('placement-layer')[0]!).findByRole('button', { name: 'Text' });
    fireEvent.click(placedButton);
    fireEvent.doubleClick(placedButton);

    const input = await screen.findByDisplayValue('Text');
    fireEvent.change(input, { target: { value: 'H' } });
    fireEvent.change(input, { target: { value: 'He' } });
    fireEvent.change(input, { target: { value: 'Hello' } });

    const placement = sessionStoreTestHarness.getState().session.documents[0]?.placements[0];
    expect(placement?.value).toBe('Hello');
    expect(sessionStoreTestHarness.getState().history.past).toHaveLength(1);
    sessionStoreTestHarness.getState().undo();
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.value).toBe('Text');
  });



  it('offers place on every page when the library tray renders', async () => {
    render(<EditorView onToast={() => {}} />);
    fireEvent.click(screen.getByText('Repeat on every page', { exact: true }));
    expect(screen.getByRole('button', { name: STRINGS.buttons.placeDateOnEveryPage })).toBeEnabled();
    expect(screen.getByRole('button', { name: STRINGS.buttons.placeTextOnEveryPage })).toBeEnabled();
  });

  it('offers an Add PDFs input in the editor header', async () => {
    render(<EditorView onToast={() => {}} />);
    expect(screen.getByRole('button', { name: STRINGS.buttons.addPdfs })).toBeEnabled();
    const input = document.querySelector('input[type="file"][accept="application/pdf"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('multiple');
  });

  it('disables mutation controls while keeping page and zoom navigation available', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    let lease: ReturnType<ReturnType<typeof sessionStoreTestHarness.getState>['acquireMutationLease']> = null;
    act(() => {
      lease = sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt');
    });

    expect(screen.getByRole('button', { name: STRINGS.library.text })).toBeDisabled();
    expect(screen.getByRole('button', { name: STRINGS.library.date })).toBeDisabled();
    expect(screen.getByRole('button', { name: STRINGS.buttons.download })).toBeDisabled();

    const zoom = screen.getByRole('button', { name: '100%' });
    expect(zoom).toBeEnabled();
    fireEvent.click(zoom);
    const pageTwo = screen.getByRole('button', { name: /Page 2/i });
    expect(pageTwo).toBeEnabled();
    fireEvent.click(pageTwo);
    expect(screen.getByText(STRINGS.editor.pageOf(2, 2))).toBeInTheDocument();

    if (lease) {
      act(() => {
        sessionStoreTestHarness.getState().releaseMutationLease(lease!);
      });
    }
  });

});
