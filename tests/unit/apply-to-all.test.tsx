import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyToAll } from '../../src/components/batch/ApplyToAll';
import { BatchPanel } from '../../src/components/batch/BatchPanel';
import { STRINGS } from '../../src/lib/strings';
import { sessionStoreTestHarness } from '../../src/stores/session';
import type { SessionDocument } from '../../src/db/schema';

const placement = {
  id: 'template-placement', type: 'text' as const, value: 'Template', fontSize: 12,
  pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1
};

function doc(docId: string, status: SessionDocument['status'] = 'pending'): SessionDocument {
  return {
    docId, fileName: `${docId}.pdf`, pdfBytes: new ArrayBuffer(0), pageCount: 1,
    pageSizes: [{ w: 612, h: 792 }], placements: [], status
  };
}

function reset(documents: SessionDocument[]) {
  sessionStoreTestHarness.setState({
    session: {
      id: 'session', createdAt: 1, updatedAt: 1, documents,
      templatePlacements: documents[0]?.placements ?? [], signatureSnapshots: {}
    },
    history: { past: [], future: [] }, selectedDocumentId: documents[0]?.docId ?? null,
    selectedPlacementId: null, copiedPlacement: null, view: 'editor', ownershipRevision: 0, contentRevision: 0
  });
}

describe('apply-to-all confirmation', () => {
  beforeEach(() => reset([]));

  it('previews Signed replacement, cancels without mutation, then confirms a fresh copy', () => {
    reset([
      { ...doc('template', 'placed'), placements: [placement] },
      { ...doc('signed', 'signed'), placements: [{ ...placement, id: 'old-placement', value: 'Old' }] }
    ]);
    const onToast = vi.fn();
    render(<ApplyToAll onToast={onToast} />);

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.applyToAll }));
    expect(screen.getByText(/Signed state will end/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.cancel }));
    expect(sessionStoreTestHarness.getState().session.documents[1]).toMatchObject({ status: 'signed' });
    expect(sessionStoreTestHarness.getState().session.documents[1]?.placements[0]?.id).toBe('old-placement');

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.applyToAll }));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));
    expect(sessionStoreTestHarness.getState().session.documents[1]).toMatchObject({ status: 'placed' });
    expect(sessionStoreTestHarness.getState().session.documents[1]?.placements[0]?.id).not.toBe('template-placement');
  });

  it('shows Signed and Needs Review as simultaneous visible states', () => {
    reset([
      { ...doc('template', 'placed'), placements: [placement] },
      { ...doc('signed', 'signed'), needsReviewReason: STRINGS.batch.needsReviewAspect }
    ]);
    render(<BatchPanel />);

    expect(screen.getByRole('button', { name: /signed\.pdf, Signed, Needs review/ })).toBeInTheDocument();
    expect(screen.getByText(STRINGS.batch.needsReviewAspect)).toBeInTheDocument();
  });

  it('announces stale preview rejection without changing previewed targets', () => {
    reset([
      { ...doc('template', 'placed'), placements: [placement] },
      { ...doc('signed', 'signed'), placements: [{ ...placement, id: 'old-placement', value: 'Old' }] }
    ]);
    const onToast = vi.fn();
    render(<ApplyToAll onToast={onToast} />);

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.applyToAll }));
    act(() => {
      sessionStoreTestHarness.getState().updatePlacement('template', placement.id, { value: 'Changed after preview' });
    });
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));

    expect(onToast).toHaveBeenCalledWith(STRINGS.batch.stalePreview);
    expect(sessionStoreTestHarness.getState().session.documents[1]).toMatchObject({ status: 'signed' });
    expect(sessionStoreTestHarness.getState().session.documents[1]?.placements[0]).toMatchObject({
      id: 'old-placement', value: 'Old'
    });
  });

  it('keeps an incompatible Signed target unchanged while adding visible Needs Review state', () => {
    reset([
      { ...doc('template', 'placed'), placements: [placement] },
      {
        ...doc('signed', 'signed'),
        pageSizes: [{ w: 1000, h: 100 }],
        placements: [{ ...placement, id: 'old-placement', value: 'Keep' }]
      }
    ]);
    const onToast = vi.fn();
    render(<ApplyToAll onToast={onToast} />);

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.applyToAll }));
    expect(screen.getByRole('dialog')).toHaveTextContent(STRINGS.batch.needsReviewAspect);
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));

    const target = sessionStoreTestHarness.getState().session.documents[1];
    expect(target).toMatchObject({ status: 'signed', needsReviewReason: STRINGS.batch.needsReviewAspect });
    expect(target?.placements[0]).toMatchObject({ id: 'old-placement', value: 'Keep' });
    expect(onToast).toHaveBeenCalledWith(STRINGS.batch.reviewSummary(1));
  });


  it('signs the rest from the selected document, not the first one', () => {
    reset([
      { ...doc('first'), placements: [{ ...placement, id: 'first-old', value: 'Old' }] },
      { ...doc('source', 'placed'), placements: [placement] },
      { ...doc('later') }
    ]);
    sessionStoreTestHarness.setState({ selectedDocumentId: 'source' });
    render(<ApplyToAll onToast={vi.fn()} />);

    expect(screen.getByText('2 ready. 0 needs review.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.signTheRest(2) }));
    expect(screen.getByRole('dialog')).toHaveTextContent(STRINGS.batch.placementsWillReplace);
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.value).toBe('Old');
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));

    const documents = sessionStoreTestHarness.getState().session.documents;
    expect(documents[1]?.placements.map((item) => item.id)).toEqual(['template-placement']);
    expect(documents[0]?.placements).toHaveLength(1);
    expect(documents[0]?.placements[0]?.id).not.toBe('template-placement');
    expect(documents[0]?.placements[0]?.value).toBe('Template');
    expect(documents[2]?.placements[0]?.value).toBe('Template');
    expect(documents[2]?.placements[0]?.id).not.toBe(documents[0]?.placements[0]?.id);
  });

  it('asks before Sign the rest overwrites, and does not download until confirm', () => {
    reset([
      { ...doc('source', 'placed'), placements: [placement] },
      { ...doc('busy', 'placed'), placements: [{ ...placement, id: 'busy-old', value: 'Busy' }] }
    ]);
    const onToast = vi.fn();
    render(<ApplyToAll onToast={onToast} />);

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.signTheRest(1) }));
    expect(screen.getByRole('dialog')).toHaveTextContent(STRINGS.batch.placementsWillReplace);
    expect(sessionStoreTestHarness.getState().session.documents[1]?.placements[0]?.id).toBe('busy-old');
    expect(onToast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));
    expect(sessionStoreTestHarness.getState().session.documents[1]?.placements[0]?.id).not.toBe('busy-old');
    expect(sessionStoreTestHarness.getState().session.documents[0]?.placements[0]?.id).toBe('template-placement');
  });

});
