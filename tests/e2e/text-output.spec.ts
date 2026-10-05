import { promises as fs } from 'fs';
import { expect, test } from '@playwright/test';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createSamplePdf } from './helpers/fixtures';

/** Extracts a page's text with pdf.js in the test process, the same library the
 *  app renders with, so "selectable and extracts correctly" is checked by a
 *  real PDF text extractor rather than a byte scan. */
async function extractText(pdfPath: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  await doc.destroy();
  return content.items.map((item) => (item as TextItem).str ?? '').join(' ');
}

async function intake(page: import('@playwright/test').Page) {
  await page.goto('/');
  // The first test in a run pays the cold start; the defaults are too tight.
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible({ timeout: 30000 });
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'text-out.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'text-out.pdf' })).toBeVisible({ timeout: 30000 });
}

async function addTextPlacement(page: import('@playwright/test').Page, value: string) {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByText('Text box added to page.')).toBeVisible();
  const placed = page.getByRole('main').getByRole('button', { name: 'Text' }).last();
  await placed.click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = page.locator('main input[value="Text"]').last();
  await input.fill(value);
  await page.keyboard.press('Tab');
}

async function downloadPdf(page: import('@playwright/test').Page, dir: string, name: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  const path = `${dir}/${name}`;
  await download.saveAs(path);
  return path;
}

test.describe('text output', () => {
  test('exports Latin text and a newline split that extracts correctly', async ({ page }) => {
    test.setTimeout(120000);
    await intake(page);
    await addTextPlacement(page, 'Signed by Anya Example\nSecond line here');

    const path = await downloadPdf(page, 'artifacts/readiness/R08', 'latin.pdf');
    const text = await extractText(path);
    expect(text).toContain('Signed by Anya Example');
    expect(text).toContain('Second line here');
  });

  test('exports Greek and Cyrillic through the bundled font', async ({ page }) => {
    test.setTimeout(120000);
    await intake(page);
    await addTextPlacement(page, 'Σύμβαση Подписано');

    const path = await downloadPdf(page, 'artifacts/readiness/R08', 'greek-cyrillic.pdf');
    const text = await extractText(path);
    expect(text).toContain('Σύμβαση');
    expect(text).toContain('Подписано');
  });

  test('refuses unsupported characters with a specific pre-export message', async ({ page }) => {
    test.setTimeout(120000);
    await intake(page);
    await addTextPlacement(page, '合同');

    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).then(
      () => 'downloaded',
      () => 'none'
    );
    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByText(/These characters can't be written into the PDF/)).toBeVisible();
    // The placement itself must still be there for the user to fix.
    await expect(page.getByRole('main').getByRole('button', { name: /合同 Edit/ })).toBeVisible();
    expect(await downloadPromise).toBe('none');
  });

  test('zoom does not change the exported document', async ({ page }) => {
    test.setTimeout(180000);
    await intake(page);
    await addTextPlacement(page, 'Zoom invariant');

    const fitPath = await downloadPdf(page, 'artifacts/readiness/R08', 'zoom-fit.pdf');
    await page.getByRole('button', { name: '150%', exact: true }).click();
    const zoomedPath = await downloadPdf(page, 'artifacts/readiness/R08', 'zoom-150.pdf');

    // Zoom is preview-only, so both exports must carry the same text at the
    // same page position. Byte equality is not required by anything and pdf-lib
    // output may differ in irrelevant ways between saves.
    const fitText = await extractText(fitPath);
    const zoomedText = await extractText(zoomedPath);
    expect(zoomedText).toBe(fitText);
    expect(fitText).toContain('Zoom invariant');
  });

  test('drops lines that do not fit the box instead of covering the page below', async ({ page }) => {
    test.setTimeout(120000);
    await intake(page);
    // The default box is 0.3 x 0.08 of the page, about three 12pt lines; a
    // 27-word paragraph needs far more than that.
    const words = Array.from({ length: 27 }, (_, i) => `word${i + 1}`).join(' ');
    await addTextPlacement(page, words);

    const path = await downloadPdf(page, 'artifacts/readiness/R08', 'truncated.pdf');
    const text = await extractText(path);
    expect(text).toContain('word1');
    // Whatever ran past the box bottom must not appear in the output.
    expect(text).not.toContain('word27');
  });
});
