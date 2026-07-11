import { act, fireEvent, render, screen } from '@testing-library/react';
import { BatchPanel } from '../../src/components/batch/BatchPanel';
import { sessionStoreTestHarness } from '../../src/stores/session';

const makeDocument = (docId: string) => ({
  docId, fileName: `${docId}.pdf`, pdfBytes: new ArrayBuffer(0), pageCount: 1,
  pageSizes: [{ w: 200, h: 100 }], placements: [], status: 'pending' as const
});

beforeEach(() => sessionStoreTestHarness.setState({
  session: { id: 'session-1', createdAt: 1, updatedAt: 1,
    documents: [makeDocument('doc-1'), makeDocument('doc-2')], templatePlacements: [], signatureSnapshots: {} },
  selectedDocumentId: 'doc-1', selectedPlacementId: null, copiedPlacement: null,
  history: { past: [], future: [] }, view: 'editor', ownershipRevision: 0, contentRevision: 0,
  mutationLease: null, mutationLock: null
}));

it('disables batch reorder and remove while preserving click and keyboard navigation', () => {
  const lease = sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt');
  if (!lease) throw new Error('Expected lease');
  render(<BatchPanel />);
  const first = screen.getByRole('button', { name: /doc-1\.pdf/i });
  const second = screen.getByRole('button', { name: /doc-2\.pdf/i });
  expect(first).toHaveAttribute('draggable', 'false');
  expect(second).toHaveAttribute('draggable', 'false');
  screen.getAllByRole('button', { name: 'Remove' }).forEach((button) => expect(button).toBeDisabled());
  fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
  expect(sessionStoreTestHarness.getState().session.documents.map((doc) => doc.docId)).toEqual(['doc-1', 'doc-2']);
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(second).toHaveFocus();
  fireEvent.click(second);
  expect(sessionStoreTestHarness.getState().selectedDocumentId).toBe('doc-2');
  act(() => { expect(sessionStoreTestHarness.getState().releaseMutationLease(lease)).toBe(true); });
});
