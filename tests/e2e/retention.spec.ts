import { expect, test, type Page } from '@playwright/test';
import { waitForRuntimeReady } from './helpers/fixtures';

async function sessionIds(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('signlite', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction('sessions').objectStore('sessions').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

test('native retention removes expired unowned records but preserves fresh and locked records', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    await owner.goto('/');
    await waitForRuntimeReady(owner);
    await owner.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('signlite', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('sessions', 'readwrite');
      for (const [id, updatedAt] of [['expired-unowned', 1], ['expired-locked', 1], ['fresh', Date.now()]] as const) {
        tx.objectStore('sessions').put({ id, createdAt: 1, updatedAt, documents: [], templatePlacements: [] });
      }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
      await new Promise<void>((resolve) => {
        void navigator.locks.request('signlite:session:expired-locked', () => {
          resolve();
          return new Promise<void>(() => {});
        });
      });
    });
    const cleaner = await context.newPage();
    await cleaner.goto('/');
    await waitForRuntimeReady(cleaner);
    await expect.poll(() => sessionIds(cleaner)).toEqual(['expired-locked', 'fresh']);
    // Releasing a native tab lock makes the old record eligible on next startup.
    await owner.close();
    await cleaner.reload();
    await waitForRuntimeReady(cleaner);
    await expect.poll(() => sessionIds(cleaner)).toEqual(['fresh']);
  } finally { await context.close(); }
});
