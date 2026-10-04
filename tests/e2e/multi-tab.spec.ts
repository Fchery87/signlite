import { expect, test } from '@playwright/test';
import { createSamplePdf } from './helpers/fixtures';

// R05 ownership: a second tab in the same browser context shares IndexedDB and
// the Web Locks namespace. It may inspect the saved Work Session, but the
// first tab's ownership lock downgrades it to read-only.
test('a second tab opens the saved session read-only while the first tab keeps saving', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext();

  const owner = await context.newPage();
  await owner.goto('/');
  await expect(owner.getByText('Drop a PDF anywhere.')).toBeVisible();
  await owner.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'owned.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(owner.getByRole('heading', { name: 'owned.pdf' })).toBeVisible();
  const layer = owner.getByTestId('placement-layer');
  await expect(layer).toBeVisible();

  // Create one durable signature placement.
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

  // The second tab shares storage: it discovers the saved session.
  const observer = await context.newPage();
  await observer.goto('/');
  await expect(observer.getByRole('button', { name: 'Resume' })).toBeVisible();
  await observer.getByRole('button', { name: 'Resume' }).click();
  await expect(observer.getByRole('heading', { name: 'owned.pdf' })).toBeVisible();
  await expect(observer.getByTestId('read-only-banner')).toBeVisible();

  // The read-only tab never writes: the owner's state stays clean.
  await expect(owner.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });

  // The owner keeps exclusive write access.
  await card.locator('button').first().dispatchEvent('dragstart', { dataTransfer });
  await layer.dispatchEvent('dragover', { dataTransfer, clientX: layerBox.x + 260, clientY: layerBox.y + 260 });
  await layer.dispatchEvent('drop', { dataTransfer, clientX: layerBox.x + 260, clientY: layerBox.y + 260 });
  await expect(owner.getByRole('main').getByRole('button', { name: 'signature' })).toHaveCount(2);
  await expect(owner.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });

  // The read-only tab still sees the owner's durable progress after reload.
  await observer.reload();
  await expect(observer.getByRole('button', { name: 'Resume' })).toBeVisible();
  await observer.getByRole('button', { name: 'Resume' }).click();
  await expect(observer.getByRole('main').getByRole('button', { name: 'signature' })).toHaveCount(2);
  await expect(observer.getByTestId('read-only-banner')).toBeVisible();

  await context.close();
});
