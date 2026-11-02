import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PlacedElement } from '../../src/components/editor/PlacedElement';
import type { Placement } from '../../src/db/schema';
import { sessionStoreTestHarness, useSessionStore } from '../../src/stores/session';

const placement: Placement = {
  id: 'toolbar-element', type: 'text', value: 'Signer', fontSize: 12,
  pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.1
};

function SelectedElement({ element = placement }: { element?: Placement }) {
  const selected = useSessionStore((state) => state.selectedPlacementId === element.id);
  return <PlacedElement documentId="toolbar-doc" pageSize={{ w: 200, h: 100 }} placement={element} scale={1} selected={selected} />;
}

beforeEach(() => {
  sessionStoreTestHarness.setState({
    session: {
      id: 'toolbar-session', createdAt: 1, updatedAt: 1,
      documents: [{ docId: 'toolbar-doc', fileName: 'form.pdf', pdfBytes: new ArrayBuffer(0), pageCount: 1,
        pageSizes: [{ w: 200, h: 100 }], placements: [placement], status: 'pending' }],
      templatePlacements: [], signatureSnapshots: {}
    },
    selectedDocumentId: 'toolbar-doc', selectedPlacementId: placement.id,
    history: { past: [], future: [] }, mutationLock: null, mutationLease: null
  });
});

describe('selected-element toolbar', () => {
  it.each(['text', 'date', 'signature', 'initials'] as const)('identifies the selected %s and preserves action names', async (type) => {
    await act(async () => { render(<SelectedElement element={{ ...placement, type, value: type === 'date' ? 'MMM d, yyyy' : placement.value }} />); });
    const toolbar = within(screen.getByRole('toolbar', { name: 'Selected element' }));
    expect(toolbar.getByText(type[0]!.toUpperCase() + type.slice(1), { exact: true })).toBeVisible();
    for (const name of ['Duplicate', 'Copy', 'Delete', 'Deselect']) {
      expect(toolbar.getByRole('button', { name })).toBeEnabled();
    }
    if (type === 'text') expect(toolbar.getByRole('button', { name: 'Edit' })).toBeEnabled();
    if (type === 'date') expect(toolbar.getByRole('button', { name: 'Cycle format' })).toBeEnabled();
    if (type === 'text' || type === 'date') expect(toolbar.getByRole('spinbutton', { name: 'Size' })).toBeEnabled();
  });

  it('deselects without changing document content or history and hides selected controls', async () => {
    await act(async () => { render(<SelectedElement />); });
    const baseline = sessionStoreTestHarness.getState();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));
    const state = sessionStoreTestHarness.getState();
    expect(state.selectedDocumentId).toBe('toolbar-doc');
    expect(state.selectedPlacementId).toBeNull();
    expect(state.session).toBe(baseline.session);
    expect(state.history).toBe(baseline.history);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resize se' })).not.toBeInTheDocument();
  });

  it('keeps Deselect available while mutations are locked', async () => {
    await act(async () => { render(<SelectedElement />); });
    act(() => { sessionStoreTestHarness.getState().acquireMutationLease('Export'); });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));
    expect(sessionStoreTestHarness.getState().selectedPlacementId).toBeNull();
  });
});
