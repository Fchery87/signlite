import {
  batchZipFileName,
  dedupeFileName,
  getFileValidationError,
  MAX_FILE_SIZE,
  MAX_SESSION_FILES,
  MAX_SESSION_PAGES,
  signedPdfFileName,
  stemFromFileName
} from '../../src/lib/files';

describe('file helpers', () => {
  it('rejects non-pdf files', () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    expect(getFileValidationError(file, 0, 0)).toBe('pdf-only');
  });

  it('rejects files above the size limit', () => {
    const file = new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'big.pdf', { type: 'application/pdf' });
    expect(getFileValidationError(file, 0, 0)).toBe('too-large');
  });

  it('rejects files beyond the session limit', () => {
    const file = new File(['a'], 'lease.pdf', { type: 'application/pdf' });
    expect(getFileValidationError(file, MAX_SESSION_FILES, 0)).toBe('session-limit');
  });

  it('exports the total page ceiling for batch sessions', () => {
    expect(MAX_SESSION_PAGES).toBe(500);
  });

  it('extracts filename stems', () => {
    expect(stemFromFileName('lease.signed.pdf')).toBe('lease.signed');
    expect(stemFromFileName('README')).toBe('README');
  });

  it('builds signed and batch download names', () => {
    expect(signedPdfFileName('lease.pdf')).toBe('lease-signed.pdf');
    expect(batchZipFileName(new Date('2026-07-07T00:00:00Z'))).toBe('signlite-batch-2026-07-07.zip');
  });

  it('dedupes colliding signed filenames', () => {
    const usedNames = new Set<string>();
    expect(dedupeFileName('lease-signed.pdf', usedNames)).toBe('lease-signed.pdf');
    expect(dedupeFileName('lease-signed.pdf', usedNames)).toBe('lease-signed-2.pdf');
    expect(dedupeFileName('lease-signed.pdf', usedNames)).toBe('lease-signed-3.pdf');
  });
});
