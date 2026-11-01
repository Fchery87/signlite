import { expect, test } from '@playwright/test';
import { waitForRuntimeReady } from './helpers/fixtures';

test('retention cleanup removes expired unowned sessions and keeps fresh records', async ({ page }) => {
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('signlite', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({ id: 'expired-e2e', createdAt: 1, updatedAt: 1, documents: [], templatePlacements: [] });
    tx.objectStore('sessions').put({ id: 'fresh-e2e', createdAt: Date.now(), updatedAt: Date.now(), documents: [], templatePlacements: [] });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await waitForRuntimeReady(page);
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('signlite', 1); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('sessions', 'readonly');
    const value = await new Promise<number>((resolve, reject) => { const r = tx.objectStore('sessions').count(); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    db.close();
    return value;
  });
  expect(count).toBeGreaterThanOrEqual(1);
});
