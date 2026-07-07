import { fireEvent, render, waitFor } from '@testing-library/react';
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

    const onDocumentsAccepted = vi.fn();
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
      expect(onDocumentsAccepted).toHaveBeenCalledWith([
        expect.objectContaining({ fileName: 'lease.pdf' })
      ]);
    });

    expect(onToast).toHaveBeenCalledWith('lease.docx — PDF only for now.');
  });

  it('reports page-ceiling rejections without accepting the file', async () => {
    createSessionDocument.mockRejectedValue(new Error('session-page-limit'));

    const onDocumentsAccepted = vi.fn();
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
});
