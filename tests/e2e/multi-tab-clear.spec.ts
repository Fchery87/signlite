import { expect, test } from '@playwright/test';
import { waitForRuntimeReady } from './helpers/fixtures';

test('history clear preserves an active session in another tab', async ({ browser }) => {
  const context = await browser.newContext();
  const owner = await context.newPage();
  const cleaner = await context.newPage();
  await owner.goto('/');
  await cleaner.goto('/');
  await waitForRuntimeReady(owner);
  await waitForRuntimeReady(cleaner);
  await owner.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('signlite', 1); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({ id: 'active-other-tab', createdAt: Date.now(), updatedAt: Date.now(), documents: [], templatePlacements: [] });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await cleaner.getByTestId('clear-history').click();
  await cleaner.getByTestId('confirm-clear').click();
  await expect(cleaner.getByText('Document history cleared. Signatures and preferences kept.')).toBeVisible();
  const remains = await owner.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('signlite', 1); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('sessions', 'readonly');
    const value = await new Promise<unknown>((resolve, reject) => { const r = tx.objectStore('sessions').get('active-other-tab'); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    db.close();
    return value;
  });
  expect(remains).toBeTruthy();
  await context.close();
});
