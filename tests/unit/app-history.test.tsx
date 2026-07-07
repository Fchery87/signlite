import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const historyMocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  loadLatestSession: vi.fn(),
  pruneOldSessions: vi.fn(),
  saveSession: vi.fn()
}));

vi.mock('../../src/db/history', () => historyMocks);
vi.mock('../../src/components/DropZone', () => ({
  DropZone: ({ currentDocumentCount }: { currentDocumentCount: number }) => <div>DropZone {currentDocumentCount}</div>
}));
vi.mock('../../src/components/editor/EditorView', () => ({
  EditorView: () => <div>Editor</div>
}));

import App from '../../src/App';
import { useSessionStore, createInitialSession } from '../../src/stores/session';
import type { WorkSession } from '../../src/db/schema';

function resetStore() {
  useSessionStore.setState({
    session: createInitialSession(),
    selectedDocumentId: null,
    selectedPlacementId: null,
    view: 'dropzone'
  });
}

function makeSavedSession(): WorkSession {
  return {
    id: 'saved-session',
    createdAt: 1,
    updatedAt: 2,
    documents: [
      {
        docId: 'doc-1',
        fileName: 'saved.pdf',
        pdfBytes: new ArrayBuffer(8),
        pageCount: 1,
        pageSizes: [{ w: 612, h: 792 }],
        placements: [],
        status: 'pending'
      }
    ],
    templatePlacements: []
  };
}

describe('App history restore', () => {
  beforeEach(() => {
    resetStore();
    historyMocks.clearSession.mockReset().mockResolvedValue(undefined);
    historyMocks.loadLatestSession.mockReset().mockResolvedValue(null);
    historyMocks.pruneOldSessions.mockReset().mockResolvedValue(undefined);
    historyMocks.saveSession.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores a saved session when resumed', async () => {
    historyMocks.loadLatestSession.mockResolvedValue(makeSavedSession());

    render(<App />);

    expect(await screen.findByText('Resume last session?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      expect(useSessionStore.getState().session.id).toBe('saved-session');
      expect(screen.queryByText('Resume last session?')).not.toBeInTheDocument();
    });
  });

  it('keeps the old session until a fresh replacement is autosaved', async () => {
    historyMocks.loadLatestSession.mockResolvedValue(makeSavedSession());

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }));

    vi.useFakeTimers();

    act(() => {
      useSessionStore.getState().addDocuments([
        {
          docId: 'doc-new',
          fileName: 'new.pdf',
          pdfBytes: new ArrayBuffer(16),
          pageCount: 1,
          pageSizes: [{ w: 612, h: 792 }],
          placements: [],
          status: 'pending'
        }
      ]);
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(historyMocks.saveSession).toHaveBeenCalledWith(expect.objectContaining({ documents: expect.any(Array) }));
    expect(historyMocks.clearSession).toHaveBeenCalledWith('saved-session');
  });
});
