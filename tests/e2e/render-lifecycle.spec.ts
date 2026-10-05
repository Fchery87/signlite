import { expect, test, type Page } from '@playwright/test';
import { createBatchPdf, createSamplePdf, waitForRuntimeReady } from './helpers/fixtures';

/** True when the editor's page canvas has at least one non-white pixel, i.e. the
 *  document actually painted rather than leaving a blank surface behind. */
async function pageIsPainted(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const canvas = document.querySelector('main canvas') as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) return true;
    }
    return false;
  });
}

async function waitForPaint(page: Page, timeout = 20000) {
  await expect.poll(() => pageIsPainted(page), { timeout, message: 'editor canvas never painted' }).toBe(true);
}

/** `frame-ancestors` cannot be delivered by a meta tag; the browser logs that on
 *  every load. It is baseline noise until R11 moves the policy to real HTTP
 *  headers, so it is excluded here rather than counted as a lifecycle failure. */
const KNOWN_CSP_META_NOTICE = "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.";

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text() !== KNOWN_CSP_META_NOTICE) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

/** The PDF input only exists in the dropzone view, so every document in a
 *  scenario has to be handed over in a single intake. */
async function intake(page: Page, files: Array<{ name: string; buffer: Buffer }>) {
  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await waitForRuntimeReady(page);
  await page
    .locator('input[accept="application/pdf"]')
    .setInputFiles(files.map((file) => ({ name: file.name, mimeType: 'application/pdf', buffer: file.buffer })));
  await expect(page.getByRole('heading', { name: files[0]!.name })).toBeVisible();
}

test.describe('PDF resource lifecycle', () => {
  test('rapid zoom and scrolling still leave a painted canvas', async ({ page }) => {
    test.setTimeout(120000);
    const errors = collectErrors(page);
    await intake(page, [{ name: 'lifecycle.pdf', buffer: await createSamplePdf() }]);
    await waitForPaint(page);

    // Supersede renders faster than they can finish.
    for (let round = 0; round < 3; round += 1) {
      for (const zoom of ['100%', '150%', 'Fit']) {
        await page.getByRole('button', { name: zoom, exact: true }).click();
      }
    }
    await waitForPaint(page);

    await page.mouse.wheel(0, 4000);
    await page.mouse.wheel(0, -4000);
    await waitForPaint(page);

    // A cancelled render is an expected outcome, not a page error.
    expect(errors).toEqual([]);
  });

  test('rapid document switching settles on a painted canvas', async ({ page }) => {
    test.setTimeout(120000);
    const errors = collectErrors(page);
    await intake(page, [
      { name: 'first.pdf', buffer: await createSamplePdf() },
      { name: 'second.pdf', buffer: await createBatchPdf('Second', 3) }
    ]);

    // Alternate faster than a load can settle, so loads are cancelled mid-flight.
    for (let round = 0; round < 4; round += 1) {
      await page.getByRole('button', { name: /first\.pdf/ }).click();
      await page.getByRole('button', { name: /second\.pdf/ }).click();
    }

    await expect(page.getByRole('heading', { name: 'second.pdf' })).toBeVisible();
    await waitForPaint(page);
    expect(errors).toEqual([]);
  });

  test('repeated document teardown leaves the editor usable and error-free', async ({ page }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await intake(page, [
      { name: 'base.pdf', buffer: await createSamplePdf() },
      { name: 'extra-0.pdf', buffer: await createBatchPdf('Extra 0', 2) },
      { name: 'extra-1.pdf', buffer: await createBatchPdf('Extra 1', 2) },
      { name: 'extra-2.pdf', buffer: await createBatchPdf('Extra 2', 2) }
    ]);
    await waitForPaint(page);

    // Every row's Remove button shares one label, so scope it to the row.
    for (const name of ['extra-0.pdf', 'extra-1.pdf', 'extra-2.pdf']) {
      await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Remove' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
      await waitForPaint(page);
    }

    // With every extra gone the list unmounts and base.pdf is the only document,
    // so it must still be the rendered one.
    await expect(page.getByRole('heading', { name: 'base.pdf' })).toBeVisible();
    await waitForPaint(page);
    expect(errors).toEqual([]);
  });
});