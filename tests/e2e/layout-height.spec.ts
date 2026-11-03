import { expect, test, type Page } from '@playwright/test';
import { createBatchPdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
}

async function expectFillsViewport(page: Page) {
  await expect.poll(() => pageOverflow(page)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('local-data-menu')).toBeInViewport();
}

async function expectContainedHorizontally(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test('desktop shell fills the viewport without page scrolling on every view', async ({ page }) => {
  test.setTimeout(120000);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 1422, height: 730 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await waitForRuntimeReady(page);

    // Dropzone: the card centers in the space between the header and footer.
    await expectFillsViewport(page);
    await expectContainedHorizontally(page);

    await page.locator('input[accept="application/pdf"]').setInputFiles({
      name: `shell-${viewport.width}.pdf`,
      mimeType: 'application/pdf',
      buffer: await createBatchPdf('Shell height', 4)
    });
    await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor({ timeout: 60000 });

    // Queue: the footer stays at the viewport edge instead of below the fold.
    await expectFillsViewport(page);
    await expectContainedHorizontally(page);

    await openQueuedDocument(page, `shell-${viewport.width}.pdf`);

    // Editor: the workspace owns the remaining height and scrolls the PDF
    // internally. A tall header must not push the shell past the viewport.
    await expectFillsViewport(page);
    await expectContainedHorizontally(page);
    const scroll = page.getByTestId('editor-scroll');
    await expect(scroll).toBeInViewport();
    expect(await scroll.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);

    // The PDF owns most of the height, and the default Fit shows a whole page.
    const viewerShare = await scroll.evaluate((node) => node.clientHeight / innerHeight);
    expect(viewerShare).toBeGreaterThan(0.6);
    const firstPage = page.getByTestId('placement-layer').first();
    await expect(firstPage).toBeVisible();
    const [pageBox, scrollBox] = [await firstPage.boundingBox(), await scroll.boundingBox()];
    expect(pageBox && scrollBox && pageBox.y + pageBox.height <= scrollBox.y + scrollBox.height + 1).toBe(true);

    await page.addStyleTag({ content: 'header { min-height: 220px; }' });
    await expectFillsViewport(page);
    await expectContainedHorizontally(page);
    await expect(scroll).toBeInViewport();
  }
});

test('phone editor scrolls naturally and keeps horizontal containment', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForRuntimeReady(page);

  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'shell-phone.pdf',
    mimeType: 'application/pdf',
    buffer: await createBatchPdf('Shell phone', 3)
  });
  await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor({ timeout: 60000 });
  await openQueuedDocument(page, 'shell-phone.pdf');

  await expectContainedHorizontally(page);
  const scroll = page.getByTestId('editor-scroll');
  await expect(scroll).toBeInViewport();

  // Local data maintenance lives in the top bar menu, not a footer over the canvas.
  await page.getByTestId('local-data-menu').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('local-data-menu')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  await expectContainedHorizontally(page);
});
