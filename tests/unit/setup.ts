import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
// The worker build ships no type declarations; only its runtime export is needed.
// @ts-expect-error pdfjs-dist/build/pdf.worker.mjs has no declaration file
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';

// jsdom does not implement the FontFace API. Text preview registers the bundled
// face through it, so a component test that mounts a text placement otherwise
// rejects after the assertion has already passed.
if (typeof FontFace === 'undefined') {
  class FontFaceStub {
    constructor(_family: string, _source: unknown) { void _family; void _source; }
    async load() {
      return this;
    }
  }
  Object.defineProperty(globalThis, 'FontFace', { value: FontFaceStub, configurable: true });
}

// jsdom does not implement URL.createObjectURL / revokeObjectURL.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-url';
  URL.revokeObjectURL = () => {};
}

// jsdom cannot spawn the pdf.js Worker and cannot import the ?url workerSrc.
// Exposing the main-thread handler lets pdf.js fall back to a fake worker.
(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
