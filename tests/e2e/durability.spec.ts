import { expect, test } from '@playwright/test';
import { createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

// R04 durability: the saved session survives a reload with identical
// placements, and the UI reports durability accurately.
test('a reload after Saved restores identical placements', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'durable.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'durable.pdf' })).toBeVisible();
  const layer = page.getByTestId('placement-layer');
  await expect(layer).toBeVisible();
  await page.waitForTimeout(1000);

  await page.getByRole('button', { name: 'Add library item' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByPlaceholder('Type your name').fill('Durable Signer');
  await page.getByRole('button', { name: 'Save' }).click();
  const card = page.locator('article').filter({ has: page.getByText('Durable Signer', { exact: true }) }).first();
  await expect(card).toBeVisible();

  // Placement is drag-only: dragstart from the card, dragover, then drop.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const layerBox = await layer.boundingBox();
  if (!layerBox) {
    throw new Error('Expected placement layer bounds');
  }
  await card.locator('button').first().dispatchEvent('dragstart', { dataTransfer });
  await layer.dispatchEvent('dragover', { dataTransfer, clientX: layerBox.x + 160, clientY: layerBox.y + 160 });
  await layer.dispatchEvent('drop', { dataTransfer, clientX: layerBox.x + 160, clientY: layerBox.y + 160 });
  await expect(page.getByRole('status').filter({ hasText: 'Signature placed on page 1.' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'signature' })).toHaveCount(1);

  // Wait for the autosave to report durable before reloading.
  await expect(page.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();

  await expect(page.getByRole('heading', { name: 'durable.pdf' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'signature' })).toHaveCount(1);
  await expect(page.getByTestId('durability-status')).toHaveText('Saved.', { timeout: 15000 });
});
