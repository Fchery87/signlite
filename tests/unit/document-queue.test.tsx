import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentQueue } from '../../src/components/queue/DocumentQueue';
import type { SessionDocument } from '../../src/db/schema';
import { saveAsset } from '../../src/db/signatures';
import { sessionStoreTestHarness } from '../../src/stores/session';

function makeDocument(docId: string, status: SessionDocument['status'] = 'pending', needsReviewReason?: string): SessionDocument {
  return {
    docId,
    fileName: `${docId}.pdf`,
    pdfBytes: new ArrayBuffer(0),
    pageCount: 1,
    pageSizes: [{ w: 612, h: 792 }],
    placements: [],
    status,
    needsReviewReason
  };
}

function reset(documents: SessionDocument[]) {
  sessionStoreTestHarness.setState({
    session: {
      id: 'queue-session',
      createdAt: 1,
      updatedAt: 1,
      documents,
      templatePlacements: [],
      signatureSnapshots: {}
    },
    selectedDocumentId: documents[0]?.docId ?? null,
    selectedPlacementId: null,
    copiedPlacement: null,
    history: { past: [], future: [] },
    view: 'queue',
    armedSignature: null,
    ownershipRevision: 0,
    contentRevision: 0,
    mutationLease: null,
    mutationLock: null
  });
}

describe('DocumentQueue', () => {
  beforeEach(() => {
    reset([
      makeDocument('doc-1'),
      makeDocument('doc-2'),
      makeDocument('doc-3'),
      makeDocument('doc-review', 'needs-review', 'Review this document.'),
      makeDocument('doc-signed', 'signed')
    ]);
  });

  it('applies the selected signature to selected documents and arms a row for placement', async () => {
    await saveAsset({
      kind: 'signature',
      source: 'typed',
      pngBytes: new Uint8Array([1, 2, 3]).buffer,
      width: 200,
      height: 80,
      label: 'Queue signature'
    });
    const onToast = vi.fn();
    render(<DocumentQueue onToast={onToast} />);

    await screen.findByText('doc-1.pdf');
    await screen.findByAltText('Queue signature');
    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[1]);
    fireEvent.click(checks[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply signature' }));
    expect(await screen.findByRole('dialog', { name: 'Apply signature to 2 documents' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 documents' }));

    await waitFor(() => {
      const documents = sessionStoreTestHarness.getState().session.documents;
      expect(documents[0]?.placements).toHaveLength(1);
      expect(documents[1]?.placements).toHaveLength(1);
      expect(documents[2]?.placements).toHaveLength(0);
    });
    expect(onToast).toHaveBeenCalledWith('Signature added to 2 documents.');

    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    const state = sessionStoreTestHarness.getState();
    expect(state.view).toBe('editor');
    expect(state.armedSignature?.label).toBe('Queue signature');
  });

  it('filters to documents that need review', async () => {
    render(<DocumentQueue onToast={vi.fn()} />);
    await screen.findByText('doc-1.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Needs review 1' }));
    expect(screen.getByText('doc-review.pdf')).toBeInTheDocument();
    expect(screen.queryByText('doc-1.pdf')).not.toBeInTheDocument();
  });
});
