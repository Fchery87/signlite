import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const historyMocks = vi.hoisted(() => ({ clearSession: vi.fn(), saveSession: vi.fn() }));
const lifecycleMock = vi.hoisted(() => ({ startupAndDiscover: vi.fn() }));

vi.mock('../../src/db/history', () => ({ ...historyMocks, loadLatestSession: vi.fn(), pruneOldSessions: vi.fn() }));
vi.mock('../../src/lib/sessionLifecycle', () => lifecycleMock);
vi.mock('../../src/components/DropZone', () => ({
  DropZone: ({ currentDocumentCount }: { currentDocumentCount: number }) => <div>DropZone {currentDocumentCount}</div>
}));
vi.mock('../../src/components/editor/EditorView', () => ({ EditorView: () => <div>Editor</div> }));

import App from '../../src/App';
import { sessionStoreTestHarness, createInitialSession } from '../../src/stores/session';
import type { WorkSession } from '../../src/db/schema';

function resetStore() {
  sessionStoreTestHarness.setState({
    session: createInitialSession(), selectedDocumentId: null, selectedPlacementId: null,
    view: 'dropzone', mutationLease: null, mutationLock: null
  });
}

function makeSavedSession(): WorkSession {
  return {
    id: 'saved-session', createdAt: 1, updatedAt: 2,
    documents: [{ docId: 'doc-1', fileName: 'saved.pdf', pdfBytes: new ArrayBuffer(8),
      pageCount: 1, pageSizes: [{ w: 612, h: 792 }], placements: [], status: 'pending' }],
    templatePlacements: []
  };
}

describe('App history restore', () => {
  beforeEach(() => {
    resetStore();
    historyMocks.clearSession.mockReset().mockResolvedValue(undefined);
    historyMocks.saveSession.mockReset().mockResolvedValue(undefined);
    lifecycleMock.startupAndDiscover.mockReset().mockResolvedValue({ candidate: null, storageAvailable: true });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('restores a saved session when resumed', async () => {
    lifecycleMock.startupAndDiscover.mockResolvedValue({ candidate: makeSavedSession(), storageAvailable: true });
    render(<App />);
    expect(await screen.findByText('Resume last session?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => { expect(sessionStoreTestHarness.getState().session.id).toBe('saved-session'); });
  });

  it('keeps the old session until a fresh replacement is autosaved', async () => {
    lifecycleMock.startupAndDiscover.mockResolvedValue({ candidate: makeSavedSession(), storageAvailable: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }));
    vi.useFakeTimers();
    act(() => {
      sessionStoreTestHarness.getState().addDocuments([{
        docId: 'doc-new', fileName: 'new.pdf', pdfBytes: new ArrayBuffer(16),
        pageCount: 1, pageSizes: [{ w: 612, h: 792 }], placements: [], status: 'pending'
      }]);
    });
    await act(async () => { vi.advanceTimersByTime(500); await Promise.resolve(); await Promise.resolve(); });
    expect(historyMocks.saveSession).toHaveBeenCalled();
    expect(historyMocks.clearSession).toHaveBeenCalledWith('saved-session');
  });

  it('announces the identified Work Session lock politely', async () => {
    render(<App />);
    await waitFor(() => { expect(lifecycleMock.startupAndDiscover).toHaveBeenCalled(); });
    let lease: ReturnType<ReturnType<typeof sessionStoreTestHarness.getState>['acquireMutationLease']> = null;
    act(() => { lease = sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt 42'); });
    const status = await screen.findByText('Work Session locked by Batch Signing attempt 42. Editing is temporarily disabled.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    if (lease) { act(() => { sessionStoreTestHarness.getState().releaseMutationLease(lease!); }); }
  });

  it('delegates startup to the lifecycle and shows no resume when candidate is null', async () => {
    render(<App />);
    await waitFor(() => { expect(lifecycleMock.startupAndDiscover).toHaveBeenCalled(); });
    await waitFor(() => { expect(screen.queryByText('Resume last session?')).not.toBeInTheDocument(); });
  });
});
