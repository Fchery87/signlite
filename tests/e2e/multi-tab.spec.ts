import { expect, test } from '@playwright/test';
import { createSamplePdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

// A second tab shares IndexedDB and the Web Locks namespace, not editing authority.
test('a second tab opens the saved session read-only while the first tab keeps saving', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    await owner.goto('/');
    await waitForRuntimeReady(owner);
    await owner.locator('input[accept="application/pdf"]').setInputFiles({ name: 'owned.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf() });
    await openQueuedDocument(owner, 'owned.pdf');
    const layer = owner.getByTestId('placement-layer');
    await expect(layer).toBeVisible();
    await owner.getByRole('button', { name: 'Add library item' }).click();
    await owner.getByRole('button', { name: 'Type', exact: true }).click();
    await owner.getByPlaceholder('Type your name').fill('Owner Signer');
    await owner.getByRole('button', { name: 'Save', exact: true }).click();
    const card = owner.locator('article').filter({ has: owner.getByText('Owner Signer', { exact: true }) }).first();
    await expect(card).toBeVisible();
    const transfer = await owner.evaluateHandle(() => new DataTransfer());
    const bounds = await layer.boundingBox();
    if (!bounds) throw new Error('Expected placement layer bounds');
    const place = async (offset: number) => {
      await card.locator('button').first().dispatchEvent('dragstart', { dataTransfer: transfer });
      await layer.dispatchEvent('dragover', { dataTransfer: transfer, clientX: bounds.x + offset, clientY: bounds.y + offset });
      await layer.dispatchEvent('drop', { dataTransfer: transfer, clientX: bounds.x + offset, clientY: bounds.y + offset });
    };
    await place(160);
    await expect(owner.getByRole('main').getByRole('button', { name: 'Signature', exact: true })).toHaveCount(1);
    await expect(owner.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });
    const observer = await context.newPage();
    await observer.goto('/');
    await waitForRuntimeReady(observer);
    await observer.getByRole('button', { name: 'Resume', exact: true }).click();
    await openQueuedDocument(observer, 'owned.pdf');
    await expect(observer.getByTestId('read-only-banner')).toBeVisible();

    // The read-only tab never saves, so it must not accept edits that would
    // silently vanish on reload.
    const observerEditor = observer.getByRole('region', { name: 'Document editor' });
    await expect(observerEditor.getByRole('button', { name: 'Add PDFs', exact: true })).toBeDisabled();
    await expect(observer.getByRole('complementary').filter({ has: observer.getByRole('heading', { name: 'Library', exact: true }) }).getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
    await observer.getByRole('button', { name: 'All documents' }).click();
    await observer.getByRole('button', { name: 'Add PDFs', exact: true }).click();
    await observer.locator('input[accept="application/pdf"]').setInputFiles({ name: 'observer.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf() });
    await expect(observer.getByText(/Not added — another tab is editing this Work Session/)).toBeVisible({ timeout: 15000 });
    await observer.getByRole('button', { name: 'Back to documents' }).click();
    await expect(observer.getByText('observer.pdf')).toHaveCount(0);

    await place(260);
    await expect(owner.getByRole('main').getByRole('button', { name: 'Signature', exact: true })).toHaveCount(2);
    await expect(owner.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });
    await observer.reload();
    await waitForRuntimeReady(observer);
    await observer.getByRole('button', { name: 'Resume', exact: true }).click();
    await openQueuedDocument(observer, 'owned.pdf');
    await expect(observer.getByRole('main').getByRole('button', { name: 'Signature', exact: true })).toHaveCount(2);
    await expect(observer.getByTestId('read-only-banner')).toBeVisible();
  } finally {
    await context.close();
  }
});
