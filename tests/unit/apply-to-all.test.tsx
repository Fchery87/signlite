import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyToAll } from '../../src/components/batch/ApplyToAll';
import { BatchPanel } from '../../src/components/batch/BatchPanel';
import { STRINGS } from '../../src/lib/strings';
import { useSessionStore } from '../../src/stores/session';
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
  useSessionStore.setState({
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
    expect(useSessionStore.getState().session.documents[1]).toMatchObject({ status: 'signed' });
    expect(useSessionStore.getState().session.documents[1]?.placements[0]?.id).toBe('old-placement');

    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.applyToAll }));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));
    expect(useSessionStore.getState().session.documents[1]).toMatchObject({ status: 'placed' });
    expect(useSessionStore.getState().session.documents[1]?.placements[0]?.id).not.toBe('template-placement');
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
      useSessionStore.getState().updatePlacement('template', placement.id, { value: 'Changed after preview' });
    });
    fireEvent.click(screen.getByRole('button', { name: STRINGS.buttons.replaceAndApply }));

    expect(onToast).toHaveBeenCalledWith(STRINGS.batch.stalePreview);
    expect(useSessionStore.getState().session.documents[1]).toMatchObject({ status: 'signed' });
    expect(useSessionStore.getState().session.documents[1]?.placements[0]).toMatchObject({
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

    const target = useSessionStore.getState().session.documents[1];
    expect(target).toMatchObject({ status: 'signed', needsReviewReason: STRINGS.batch.needsReviewAspect });
    expect(target?.placements[0]).toMatchObject({ id: 'old-placement', value: 'Keep' });
    expect(onToast).toHaveBeenCalledWith(STRINGS.batch.reviewSummary(1));
  });

});
