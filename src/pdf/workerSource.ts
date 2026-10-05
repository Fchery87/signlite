/** The pdf.js worker source as a string, so workers are built from resident
 *  bytes (a blob URL) instead of a script URL the CSP accounting has to trust.
 *  Its whole purpose is to sit in its own lazy chunk, out of the entry. */
export { default as pdfWorkerSource } from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
