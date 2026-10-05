import { expect, test } from '@playwright/test';
import { waitForRuntimeReady } from './helpers/fixtures';

async function storeCounts(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('signlite', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['sessions', 'signatures'], 'readonly');
    const sessions = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore('sessions').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const signatures = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore('signatures').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { sessions, signatures };
  });
}

test('clearing history keeps signatures and clearing all removes them', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await waitForRuntimeReady(page);

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('signlite', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['sessions', 'signatures'], 'readwrite');
    tx.objectStore('sessions').put({
      id: 'old-session',
      createdAt: 1,
      updatedAt: 1,
      documents: [],
      templatePlacements: []
    });
    tx.objectStore('signatures').put({
      id: 'kept-signature',
      kind: 'signature',
      source: 'uploaded',
      pngBytes: new ArrayBuffer(4),
      width: 2,
      height: 1,
      label: 'Kept',
      createdAt: 1,
      lastUsedAt: 1
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.getByTestId('clear-history').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await storeCounts(page)).toEqual({ sessions: 1, signatures: 1 });

  await page.getByTestId('clear-history').click();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByText('Document history cleared. Signatures and preferences kept.')).toBeVisible();
  expect(await storeCounts(page)).toEqual({ sessions: 0, signatures: 1 });

  await page.getByTestId('clear-all-data').click();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByText('All local data cleared.')).toBeVisible();
  expect(await storeCounts(page)).toEqual({ sessions: 0, signatures: 0 });
});
