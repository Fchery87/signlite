import { expect, test } from '@playwright/test';
import { createSamplePdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

test('history clear preserves a record held by another tab and reports partial cleanup', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    const cleaner = await context.newPage();
    await owner.goto('/');
    await waitForRuntimeReady(owner);
    await owner.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('signlite', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put({ id: 'active-other-tab', createdAt: 1, updatedAt: Date.now(), documents: [], templatePlacements: [] });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
      await new Promise<void>((acquired) => {
        void navigator.locks.request('signlite:session:active-other-tab', () => {
          acquired();
          return new Promise<void>(() => {});
        });
      });
    });
    await cleaner.goto('/');
    await waitForRuntimeReady(cleaner);
    await cleaner.getByTestId('clear-history').click();
    await cleaner.getByTestId('confirm-clear').click();
    await expect(cleaner.getByText(/Kept 1 active or changed sessions/)).toBeVisible();
    const remains = await owner.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('signlite', 1); request.onsuccess = () => resolve(request.result); });
      const found = await new Promise<boolean>((resolve) => { const request = db.transaction('sessions').objectStore('sessions').get('active-other-tab'); request.onsuccess = () => resolve(!!request.result); });
      db.close();
      return found;
    });
    expect(remains).toBe(true);
  } finally { await context.close(); }
});

test('full clear refuses another active tab without discarding current work', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    const cleaner = await context.newPage();
    await owner.goto('/');
    await cleaner.goto('/');
    await waitForRuntimeReady(owner);
    await waitForRuntimeReady(cleaner);
    await cleaner.locator('input[accept="application/pdf"]').setInputFiles({ name: 'preserved.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf() });
    await openQueuedDocument(cleaner, 'preserved.pdf');
    await cleaner.getByRole('complementary').filter({ has: cleaner.getByRole('heading', { name: 'Library', exact: true }) }).getByRole('button', { name: 'Text', exact: true }).click();
    await expect(cleaner.getByTestId('durability-status')).toHaveText('Saved.');
    await cleaner.getByTestId('clear-all-data').click();
    await cleaner.getByTestId('confirm-clear').click();
    await expect(cleaner.getByText('Local data could not be cleared. Your current work has not been reset.')).toBeVisible();
    await expect(cleaner.getByRole('dialog')).toBeVisible();
    await cleaner.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(cleaner.getByRole('heading', { name: 'preserved.pdf' })).toBeVisible();
    await cleaner.getByRole('complementary').filter({ has: cleaner.getByRole('heading', { name: 'Library', exact: true }) }).getByRole('button', { name: 'Text', exact: true }).click();
    await expect(cleaner.getByRole('main').getByRole('button', { name: 'Text', exact: true })).toHaveCount(2);
    await expect(cleaner.getByTestId('durability-status')).toHaveText('Saved.');
    await cleaner.reload();
    await waitForRuntimeReady(cleaner);
    await cleaner.getByRole('button', { name: 'Resume', exact: true }).click();
    await openQueuedDocument(cleaner, 'preserved.pdf');
    await expect(cleaner.getByRole('main').getByRole('button', { name: 'Text', exact: true })).toHaveCount(2);
  } finally { await context.close(); }
});
