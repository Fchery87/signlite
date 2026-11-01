import { expect, test } from '@playwright/test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

test('download applies the restricted action policy and keeps searchable content', async ({ page }) => {
  const pdf = await PDFDocument.load(await createSamplePdf());
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("fixture")') }));
  const source = Buffer.from(await pdf.save());
  const requests: string[] = [];
  await page.goto('/');
  await waitForRuntimeReady(page);
  page.on('request', (request) => { if (request.url().startsWith('http')) requests.push(request.url()); });
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'policy.pdf', mimeType: 'application/pdf', buffer: source });
  await expect(page.getByRole('heading', { name: 'policy.pdf', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByTestId('placement-layer').click({ position: { x: 150, y: 150 } });
  await expect(page.getByRole('main').getByRole('button', { name: 'Text', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('Missing output file');
  const output = await PDFDocument.load(await readFile(path));
  expect(output.catalog.has(PDFName.of('OpenAction'))).toBe(false);
  expect(output.getPage(0).node.Contents()).toBeDefined();
  expect((await PDFDocument.load(source)).catalog.has(PDFName.of('OpenAction'))).toBe(true);
  expect(requests).toEqual([]);
});
