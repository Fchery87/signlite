import { expect, test } from '@playwright/test';
import { createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

// R05 ownership: a second tab in the same browser context shares IndexedDB and
// the Web Locks namespace. It may inspect the saved Work Session, but the
// first tab's ownership lock downgrades it to read-only.
test('a second tab opens the saved session read-only while the first tab keeps saving', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  const owner = await context.newPage();
  await owner.goto('/');
  await expect(owner.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(owner);
  await owner.locator('input[accept="application/pdf"]').setInputFiles({ name: 'owned.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf() });
  await expect(owner.getByRole('heading', { name: 'owned.pdf' })).toBeVisible();
  const layer = owner.getByTestId('placement-layer');
  await expect(layer).toBeVisible();
  await owner.getByRole('button', { name: 'Add library item' }).click();
  await owner.getByRole('button', { name: 'Type' }).click();
  await owner.getByPlaceholder('Type your name').fill('Owner Signer');
  await owner.getByRole('button', { name: 'Save' }).click();
  const card = owner.locator('article').filter({ has: owner.getByText('Owner Signer', { exact: true }) }).first();
  await expect(card).toBeVisible();
  const dataTransfer = await owner.evaluateHandle(() => new DataTransfer());
  const layerBox = await layer.boundingBox();
  if (!layerBox) throw new Error('Expected placement layer bounds');
  await card.locator('button').first().dispatchEvent('dragstart', { dataTransfer });
  await layer.dispatchEvent('dragover', { dataTransfer, clientX: layerBox.x + 160, clientY: layerBox.y + 160 });
  await layer.dispatchEvent('drop', { dataTransfer, clientX: layerBox.x + 160, clientY: layerBox.y + 160 });
  await expect(owner.getByRole('main').getByRole('button', { name: 'signature' })).toHaveCount(1);
  await expect(owner.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });
  const observer = await context.newPage();
  await observer.goto('/');
  await waitForRuntimeReady(observer);
  await expect(observer.getByRole('button', { name: 'Resume' })).toBeVisible();
  await observer.getByRole('button', { name: 'Resume' }).click();
  await expect(observer.getByRole('heading', { name: 'owned.pdf' })).toBeVisible();
  await expect(observer.getByTestId('read-only-banner')).toBeVisible();
  await expect(owner.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });
  await context.close();
});

// A full-clear request must not erase a session held by another tab.
test('full clear refuses while another tab owns a discovered session', async ({ browser }) => {
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
    tx.objectStore('sessions').put({ id: 'other-tab-session', createdAt: Date.now(), updatedAt: Date.now(), documents: [], templatePlacements: [] });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await cleaner.getByTestId('clear-all-data').click();
  await cleaner.getByTestId('confirm-clear').click();
  await expect(cleaner.getByText('Local data could not be cleared. Your current work has not been reset.')).toBeVisible();
  await context.close();
});
