import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const BATCH_SENTINEL = 'SIGNLITE BATCH OK';
const BATCH_SENTINEL_HEX = Buffer.from(BATCH_SENTINEL, 'utf8').toString('hex').toUpperCase();

function readPageContent(pdf: PDFDocument, pageIndex: number) {
  const contents = pdf.getPage(pageIndex).node.Contents();
  if (!contents) {
    return '';
  }

  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((entry) => pdf.context.lookup(entry))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n');
}

async function createBatchPdf(label: string) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    const page = pdfDoc.addPage([612, 792]);
    page.drawText(`${label} — page ${pageNumber}`, {
      x: 72,
      y: 700,
      size: 24,
      font,
      color: rgb(0.07, 0.09, 0.15)
    });

    page.drawText('Batch signing should stay local.', {
      x: 72,
      y: 660,
      size: 14,
      font,
      color: rgb(0.25, 0.3, 0.38)
    });
  }

  return Buffer.from(await pdfDoc.save());
}

test('restores a batch session and downloads a quiet signed zip', async ({ page }) => {
  test.setTimeout(90000);
  const requests: string[] = [];
  let captureRequests = false;

  page.on('request', (request) => {
    const url = request.url();
    if (
      !captureRequests ||
      !/^https?:/i.test(url) ||
      url.includes('/assets/pdf.worker.min-') ||
      url.includes('/assets/flatten.worker-')
    ) {
      return;
    }
    requests.push(`${request.method()} ${url}`);
  });

  const fixtures = await Promise.all(
    Array.from({ length: 10 }, async (_, index) => {
      const fileName = `batch-${String(index + 1).padStart(2, '0')}.pdf`;
      const buffer = await createBatchPdf(fileName);
      return {
        name: fileName,
        mimeType: 'application/pdf',
        buffer
      };
    })
  );
  const sourceSizes = Object.fromEntries(fixtures.map((fixture) => [fixture.name, fixture.buffer.byteLength]));

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();

  await page.locator('input[accept="application/pdf"]').setInputFiles(fixtures);

  const batchPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Batch' }) }).first();
  const batchItems = batchPanel.locator('[draggable="true"][role="button"]');

  await expect(batchPanel.getByRole('heading', { name: 'Batch', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(batchPanel.getByText('batch-10.pdf')).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'batch-01.pdf' })).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1000);
  captureRequests = true;

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const templateTarget = batchItems.filter({ hasText: 'batch-01.pdf' }).first();
  const newTemplate = batchItems.filter({ hasText: 'batch-03.pdf' }).first();
  await newTemplate.dispatchEvent('dragstart', { dataTransfer });
  await templateTarget.dispatchEvent('dragover', { dataTransfer });
  await templateTarget.dispatchEvent('drop', { dataTransfer });

  await expect(batchItems.nth(0)).toContainText('batch-03.pdf');
  await newTemplate.click();
  await expect(page.getByRole('heading', { name: 'batch-03.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text' })).toBeVisible();
  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByText('Text box added to page.')).toBeVisible();
  const placedText = page.getByRole('main').getByRole('button', { name: 'Text' }).last();
  await placedText.click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('main input[value="Text"]').last().fill(BATCH_SENTINEL);
  await page.keyboard.press('Tab');

  await page.getByRole('button', { name: 'Apply to all' }).click();
  await expect(page.getByText('Applied to 9 documents.')).toBeVisible();
  await expect.poll(async () => batchPanel.locator('span').filter({ hasText: 'Placed' }).count()).toBe(10);

  await page.waitForTimeout(700);
  captureRequests = false;
  await page.reload();
  await expect(page.getByText('Resume last session?')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();

  await expect(page.getByRole('heading', { name: 'batch-03.pdf' })).toBeVisible();
  await expect(batchItems.nth(0)).toContainText('batch-03.pdf');
  await expect(batchItems.nth(1)).toContainText('batch-01.pdf');
  await expect.poll(async () => batchPanel.locator('span').filter({ hasText: 'Placed' }).count()).toBe(10);
  await expect(page.getByText('10 documents ready for zip download.')).toBeVisible();

  requests.length = 0;
  captureRequests = true;

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^signlite-batch-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText('Done. 10 documents signed.')).toBeVisible({ timeout: 15000 });

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const archive = await readFile(downloadPath as string);
  const files = unzipSync(new Uint8Array(archive));
  const fileNames = Object.keys(files).sort();

  expect(fileNames).toEqual(fixtures.map((fixture) => fixture.name.replace('.pdf', '-signed.pdf')).sort());

  for (const [fileName, pdfBytes] of Object.entries(files)) {
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdfBytes.byteLength).toBeGreaterThan(sourceSizes[fileName.replace('-signed.pdf', '.pdf')] ?? 0);
    expect(readPageContent(pdf, 0)).toContain(BATCH_SENTINEL_HEX);
  }

  expect(requests).toEqual([]);
});
