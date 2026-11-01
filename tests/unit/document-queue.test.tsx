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

async function chooseSignature(label: string) {
  const change = screen.queryByRole('button', { name: 'Change' });
  if (change) {
    fireEvent.click(change);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
  }
  await screen.findByAltText(label);
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
    await chooseSignature('Queue signature');
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

  it('moves a document with Alt plus Arrow Down', async () => {
    render(<DocumentQueue onToast={vi.fn()} />);
    await screen.findByText('doc-1.pdf');
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder doc-1\.pdf/ }), { key: 'ArrowDown', altKey: true });
    expect(sessionStoreTestHarness.getState().session.documents.map((document) => document.docId).slice(0, 3)).toEqual(['doc-2', 'doc-1', 'doc-3']);
  });

  it('copies template placements and removes a document from row actions', async () => {
    reset([
      {
        ...makeDocument('source', 'placed'),
        placements: [{
          id: 'text-1',
          type: 'text',
          value: 'Template',
          fontSize: 12,
          pageIndex: 0,
          x: 0.1,
          y: 0.1,
          w: 0.2,
          h: 0.1
        }]
      },
      makeDocument('target')
    ]);
    const onToast = vi.fn();
    render(<DocumentQueue onToast={onToast} />);
    await screen.findByText('source.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'More actions for source.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy placements to all' }));
    expect(await screen.findByRole('dialog', { name: 'Copy placements from source.pdf?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy to 1 document' }));

    await waitFor(() => {
      expect(sessionStoreTestHarness.getState().session.documents[1]?.placements).toHaveLength(1);
    });
    expect(onToast).toHaveBeenCalledWith('Applied to 1 document.');

    fireEvent.click(screen.getByRole('button', { name: 'More actions for source.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(sessionStoreTestHarness.getState().session.documents.map((document) => document.docId)).toEqual(['target', 'source']);

    fireEvent.click(screen.getByRole('button', { name: 'More actions for target.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from session' }));
    expect(sessionStoreTestHarness.getState().session.documents.map((document) => document.docId)).toEqual(['source']);
  });

  it('replaces existing signatures and keeps review state after confirmation', async () => {
    reset([
      {
        ...makeDocument('doc-existing', 'signed'),
        placements: [{
          id: 'old-signature',
          type: 'signature',
          snapshotId: 'old-snapshot',
          pageIndex: 0,
          x: 0.1,
          y: 0.1,
          w: 0.2,
          h: 0.1
        }]
      },
      makeDocument('doc-review', 'needs-review', 'Review this document.')
    ]);
    await saveAsset({
      kind: 'signature',
      source: 'typed',
      pngBytes: new Uint8Array([4, 5, 6]).buffer,
      width: 200,
      height: 80,
      label: 'Replacement signature'
    });
    render(<DocumentQueue onToast={vi.fn()} />);
    await chooseSignature('Replacement signature');

    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[1]);
    fireEvent.click(checks[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply signature' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply signature to 2 documents' });
    expect(dialog).toHaveTextContent('Existing signatures or initials are replaced on 1 document.');
    expect(dialog).toHaveTextContent('1 document keeps Needs review after placement.');
    expect(dialog).toHaveTextContent('Signed state ends on 1 document.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 documents' }));

    await waitFor(() => {
      const documents = sessionStoreTestHarness.getState().session.documents;
      expect(documents[0]?.placements).toHaveLength(1);
      expect(documents[0]?.placements[0]?.id).not.toBe('old-signature');
      expect(documents[0]?.status).toBe('placed');
      expect(documents[1]?.placements).toHaveLength(1);
      expect(documents[1]?.status).toBe('needs-review');
      expect(documents[1]?.needsReviewReason).toBe('Review this document.');
    });
  });
}, 15000);
