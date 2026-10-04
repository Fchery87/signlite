import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DropZone } from '../../src/components/DropZone';

const { createSessionDocument } = vi.hoisted(() => ({
  createSessionDocument: vi.fn()
}));

vi.mock('../../src/lib/files', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/files')>('../../src/lib/files');
  return {
    ...actual,
    createSessionDocument
  };
});

describe('DropZone', () => {
  beforeEach(() => {
    createSessionDocument.mockReset();
  });

  it('loads valid PDFs and reports invalid files', async () => {
    createSessionDocument.mockResolvedValue({
      docId: 'doc-1',
      fileName: 'lease.pdf',
      pdfBytes: new ArrayBuffer(0),
      pageCount: 1,
      pageSizes: [{ w: 612, h: 792 }],
      placements: [],
      status: 'pending'
    });

    const onDocumentsAccepted = vi.fn().mockReturnValue('ok');
    const onToast = vi.fn();
    const { container } = render(
      <DropZone currentDocumentCount={0} currentPageCount={0} onDocumentsAccepted={onDocumentsAccepted} onToast={onToast} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['pdf'], 'lease.pdf', { type: 'application/pdf' });
    const docx = new File(['docx'], 'lease.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    fireEvent.change(input, { target: { files: [pdf, docx] } });

    await waitFor(() => {
      expect(onDocumentsAccepted).toHaveBeenCalledWith([expect.objectContaining({ fileName: 'lease.pdf' })], undefined);
      expect(screen.getByText('Ready, 1 page.')).toBeVisible();
    });

    expect(onToast).toHaveBeenCalledWith('lease.docx — PDF only for now.');
    expect(screen.getByText('lease.docx — PDF only for now.')).toBeVisible();
  });

  it('reports aggregate byte-limit rejections without accepting the file', async () => {
    const onDocumentsAccepted = vi.fn().mockReturnValue('ok');
    const onToast = vi.fn();
    const { container } = render(
      <DropZone currentDocumentCount={0} currentPageCount={0} currentByteCount={500 * 1024 * 1024 - 1} onDocumentsAccepted={onDocumentsAccepted} onToast={onToast} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File([new Uint8Array(2)], 'overflow.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [pdf] } });

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('overflow.pdf — Session limit is 500 MB of PDFs total.');
      expect(screen.getByText('overflow.pdf — Session limit is 500 MB of PDFs total.')).toBeVisible();
    });
    expect(onDocumentsAccepted).not.toHaveBeenCalled();
  });

  it('reports page-ceiling rejections without accepting the file', async () => {
    createSessionDocument.mockRejectedValue(new Error('session-page-limit'));

    const onDocumentsAccepted = vi.fn().mockReturnValue('ok');
    const onToast = vi.fn();
    const { container } = render(
      <DropZone currentDocumentCount={1} currentPageCount={499} onDocumentsAccepted={onDocumentsAccepted} onToast={onToast} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['pdf'], 'overflow.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [pdf] } });

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('overflow.pdf — Session limit is 500 pages total.');
    });
    expect(onDocumentsAccepted).not.toHaveBeenCalled();
  });

  it('reports when the store refuses the intake result', async () => {
    createSessionDocument.mockResolvedValue({
      docId: 'doc-1',
      fileName: 'lease.pdf',
      pdfBytes: new ArrayBuffer(0),
      pageCount: 1,
      pageSizes: [{ w: 612, h: 792 }],
      placements: [],
      status: 'pending'
    });

    const onDocumentsAccepted = vi.fn().mockReturnValue('session-changed');
    const onToast = vi.fn();
    const { container } = render(
      <DropZone
        currentDocumentCount={0}
        currentPageCount={0}
        sessionId="session-1"
        onDocumentsAccepted={onDocumentsAccepted}
        onToast={onToast}
      />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['pdf'], 'lease.pdf', { type: 'application/pdf' })] } });

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('That import no longer matches this session.');
    });
  });

  it('queues a second intake until the first finishes, then commits against fresh budgets', async () => {
    createSessionDocument.mockImplementation(async (file: File) => ({
      docId: `doc-${file.name}`,
      fileName: file.name,
      pdfBytes: new ArrayBuffer(0),
      pageCount: 1,
      pageSizes: [{ w: 612, h: 792 }],
      placements: [],
      status: 'pending'
    }));

    const onDocumentsAccepted = vi.fn().mockReturnValue('ok');
    const onToast = vi.fn();
    const { container, rerender } = render(
      <DropZone currentDocumentCount={0} currentPageCount={0} sessionId="session-1" onDocumentsAccepted={onDocumentsAccepted} onToast={onToast} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const first = new File(['pdf'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['pdf'], 'second.pdf', { type: 'application/pdf' });

    let resolveFirst: ((value: unknown) => void) | undefined;
    createSessionDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });

    // Flush so the first queued intake starts and parks on its promise.
    await waitFor(() => {
      expect(createSessionDocument).toHaveBeenCalledTimes(1);
    });

    // The queued run must see the budgets the first intake produced, not the
    // props captured when it was enqueued.
    rerender(
      <DropZone currentDocumentCount={1} currentPageCount={1} sessionId="session-1" onDocumentsAccepted={onDocumentsAccepted} onToast={onToast} />
    );
    resolveFirst?.({
      docId: 'doc-first.pdf',
      fileName: 'first.pdf',
      pdfBytes: new ArrayBuffer(0),
      pageCount: 1,
      pageSizes: [{ w: 612, h: 792 }],
      placements: [],
      status: 'pending'
    });

    await waitFor(() => {
      expect(onDocumentsAccepted).toHaveBeenCalledTimes(2);
    });
    expect(onDocumentsAccepted).toHaveBeenNthCalledWith(1, [expect.objectContaining({ fileName: 'first.pdf' })], 'session-1');
    expect(onDocumentsAccepted).toHaveBeenNthCalledWith(2, [expect.objectContaining({ fileName: 'second.pdf' })], 'session-1');
  });

  it('rejects the 51st document before parsing and accepts the valid subset of a mixed batch', async () => {
    createSessionDocument.mockImplementation(async (file: File) => ({
      docId: `doc-${file.name}`,
      fileName: file.name,
      pdfBytes: new ArrayBuffer(0),
      pageCount: 1,
      pageSizes: [{ w: 612, h: 792 }],
      placements: [],
      status: 'pending'
    }));

    const onDocumentsAccepted = vi.fn().mockReturnValue('ok');
    const onToast = vi.fn();
    const { container } = render(
      <DropZone currentDocumentCount={49} currentPageCount={0} onDocumentsAccepted={onDocumentsAccepted} onToast={onToast} />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const first = new File(['pdf'], 'fits.pdf', { type: 'application/pdf' });
    const second = new File(['pdf'], 'is-51st.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => {
      expect(onDocumentsAccepted).toHaveBeenCalledTimes(1);
    });
    expect(onDocumentsAccepted).toHaveBeenCalledWith([expect.objectContaining({ fileName: 'fits.pdf' })], undefined);
    expect(screen.getByText('is-51st.pdf — Session limit is 50 documents.')).toBeVisible();
    expect(createSessionDocument).toHaveBeenCalledTimes(1);
  });
});
