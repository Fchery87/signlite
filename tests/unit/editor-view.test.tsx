import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { EditorView } from '../../src/components/editor/EditorView';
import { useSessionStore } from '../../src/stores/session';
import { STRINGS } from '../../src/lib/strings';

vi.mock('../../src/pdf/render', () => ({
  loadDocument: vi.fn(async () => ({ destroy: vi.fn() })),
  renderPage: vi.fn(async () => undefined)
}));

vi.mock('../../src/pdf/flatten', () => ({
  flattenDocument: vi.fn()
}));

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
};

const intersectionObservers: ObserverRecord[] = [];

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionObservers.push({ callback, observer: this as unknown as IntersectionObserver });
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

function emitVisibility(observerIndex: number, ratio: number) {
  const record = intersectionObservers[observerIndex];
  record?.callback(
    [{ intersectionRatio: ratio, isIntersecting: ratio > 0 } as IntersectionObserverEntry],
    record.observer
  );
}

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
    view: 'editor'
  });
}

describe('editor view', () => {
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

    const placements = useSessionStore.getState().session.documents[0]?.placements ?? [];
    expect(placements).toHaveLength(2);
    expect(placements[0]?.pageIndex).toBe(1);
    expect(placements[1]?.pageIndex).toBe(1);
  });

  it('lets the user type more than one character into a text placement', async () => {
    render(<EditorView onToast={() => {}} />);
    await waitFor(() => expect(intersectionObservers.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: STRINGS.library.text }));

    const placed = await screen.findByText('Text', { selector: 'span' });
    const placedButton = placed.closest('[role="button"]')!;
    fireEvent.click(placedButton);
    fireEvent.doubleClick(placedButton);

    const input = await screen.findByDisplayValue('Text');
    fireEvent.change(input, { target: { value: 'H' } });
    fireEvent.change(input, { target: { value: 'He' } });
    fireEvent.change(input, { target: { value: 'Hello' } });

    const placement = useSessionStore.getState().session.documents[0]?.placements[0];
    expect(placement?.value).toBe('Hello');
  });
});
