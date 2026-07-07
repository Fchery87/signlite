const { loadDocument } = vi.hoisted(() => ({
  loadDocument: vi.fn()
}));

vi.mock('../../src/pdf/render', async () => {
  const actual = await vi.importActual<typeof import('../../src/pdf/render')>('../../src/pdf/render');
  return {
    ...actual,
    loadDocument
  };
});

import { createSessionDocument } from '../../src/lib/files';
import { SignlitePdfError } from '../../src/pdf/render';

function makePdfFile(name: string) {
  return {
    name,
    arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
  } as unknown as File;
}

describe('createSessionDocument', () => {
  beforeEach(() => {
    loadDocument.mockReset();
  });

  it('extracts page sizes from a loaded pdf', async () => {
    loadDocument.mockResolvedValue({
      numPages: 2,
      getPage: vi
        .fn()
        .mockResolvedValueOnce({ getViewport: () => ({ width: 612, height: 792 }) })
        .mockResolvedValueOnce({ getViewport: () => ({ width: 612, height: 1008 }) })
    });

    const doc = await createSessionDocument(makePdfFile('lease.pdf'));

    expect(doc.fileName).toBe('lease.pdf');
    expect(doc.pageCount).toBe(2);
    expect(doc.pageSizes).toEqual([
      { w: 612, h: 792 },
      { w: 612, h: 1008 }
    ]);
  });

  it('preserves encrypted pdf errors', async () => {
    loadDocument.mockRejectedValue(new SignlitePdfError('encrypted'));

    await expect(createSessionDocument(makePdfFile('locked.pdf'))).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('rejects zero-page pdfs as corrupt', async () => {
    loadDocument.mockResolvedValue({
      numPages: 0,
      getPage: vi.fn()
    });

    await expect(createSessionDocument(makePdfFile('empty.pdf'))).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('rejects files that would push the session past 500 pages', async () => {
    loadDocument.mockResolvedValue({
      numPages: 2,
      getPage: vi.fn()
    });

    await expect(
      createSessionDocument(makePdfFile('overflow.pdf'), {
        currentPageCount: 499,
        acceptedPageCount: 0
      })
    ).rejects.toMatchObject({ message: 'session-page-limit' });
  });
});
