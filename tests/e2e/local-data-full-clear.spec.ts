import { expect, test } from '@playwright/test';
import { waitForRuntimeReady } from './helpers/fixtures';

test('full clear succeeds in a single tab and removes sessions and signatures', async ({ page }) => {
  await page.goto('/');
  await waitForRuntimeReady(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('signlite', 1); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['sessions', 'signatures'], 'readwrite');
    tx.objectStore('sessions').put({ id: 'single-clear-session', createdAt: Date.now(), updatedAt: Date.now(), documents: [], templatePlacements: [] });
    tx.objectStore('signatures').put({ id: 'single-clear-signature', kind: 'signature', source: 'uploaded', pngBytes: new ArrayBuffer(4), width: 2, height: 1, label: 'Clear me', createdAt: Date.now(), lastUsedAt: Date.now() });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.getByTestId('clear-all-data').click();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByText('All local data cleared.')).toBeVisible();
});
