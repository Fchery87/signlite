import { expect, test } from '@playwright/test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { createSamplePdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

test('import rollback keeps both asset additions and preference counters atomic and retry succeeds', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'import-abort.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf() });
  await openQueuedDocument(page, 'import-abort.pdf');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let injected = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = original.apply(this, args);
      if (this.name === 'prefs' && !injected) { injected = true; document.documentElement.dataset.importAbort = 'injected'; this.transaction.abort(); }
      return request;
    };
  });
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; canvas.getContext('2d')!.fillRect(0, 0, 2, 2); return canvas.toDataURL('image/png').split(',')[1]; });
  const payload = Buffer.from(JSON.stringify({ version: 1, signatures: ['a', 'b'].map((id) => ({ id, kind: 'signature', source: 'uploaded', pngBytes: png, width: 2, height: 2, label: id, createdAt: 1, lastUsedAt: 1 })) }));
  const inspect = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('signlite', 1); r.onsuccess = () => resolve(r.result); });
    const count = await new Promise<number>((resolve) => { const r = db.transaction('signatures').objectStore('signatures').count(); r.onsuccess = () => resolve(r.result); });
    const additions = await new Promise<number>((resolve) => { const r = db.transaction('prefs').objectStore('prefs').get('prefs'); r.onsuccess = () => resolve(r.result?.assetsAddedSinceExport ?? 0); });
    db.close();
    return { count, additions };
  });
  await page.locator('input[accept="application/json"]').setInputFiles({ name: 'atomic.json', mimeType: 'application/json', buffer: payload });
  await expect(page.locator('input[accept="application/json"]')).toHaveValue('');
  await expect(page.locator('html')).toHaveAttribute('data-import-abort', 'injected');
  expect(await inspect()).toEqual({ count: 0, additions: 0 });
  await page.locator('input[accept="application/json"]').setInputFiles({ name: 'atomic.json', mimeType: 'application/json', buffer: payload });
  await expect(page.getByText('Added 2. Skipped 0 duplicates.')).toBeVisible();
  expect(await inspect()).toEqual({ count: 2, additions: 2 });
  expect(errors).toEqual([]);
});

test('cyclic supported action graph refuses export without download or signed status and preserves source', async ({ page }) => {
  test.setTimeout(120000);
  const pdf = await PDFDocument.load(await createSamplePdf());
  const action = pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('fixture') });
  const ref = pdf.context.register(action);
  action.set(PDFName.of('Next'), ref);
  pdf.catalog.set(PDFName.of('OpenAction'), ref);
  const source = Buffer.from(await pdf.save());
  await page.goto('/');
  await waitForRuntimeReady(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'cyclic.pdf', mimeType: 'application/pdf', buffer: source });
  await openQueuedDocument(page, 'cyclic.pdf');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('Cannot safely apply PDF export policy: cyclic action chain.')).toBeVisible();
  await expect(page.getByTestId('durability-status')).toHaveText('Saved.');
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('signlite', 1); r.onsuccess = () => resolve(r.result); });
    const sessions = await new Promise<Array<{documents: Array<{status: string; pdfBytes: ArrayBuffer}>}>>((resolve) => { const r = db.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close();
    return { status: sessions[0].documents[0].status, source: Array.from(new Uint8Array(sessions[0].documents[0].pdfBytes)) };
  });
  expect(stored.status).not.toBe('signed');
  expect(Buffer.from(stored.source)).toEqual(source);
  expect(downloads).toEqual([]);
});
