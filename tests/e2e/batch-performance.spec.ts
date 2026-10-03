import { expect, test } from '@playwright/test';
import { createPerformancePdf, pdfFixture } from './helpers/fixtures';

const DOCUMENT_COUNT = 20;
const MAX_BATCH_MS = 30_000;

test('keeps the production batch path responsive for a 20-document stack', async ({ page }) => {
  test.setTimeout(120_000);
  const fixtures = await Promise.all(
    Array.from({ length: DOCUMENT_COUNT }, async (_, index) =>
      pdfFixture(`performance-${String(index + 1).padStart(2, '0')}.pdf`, await createPerformancePdf(`Performance ${index + 1}`))
    )
  );

  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await page.locator('input[accept="application/pdf"]').setInputFiles(fixtures);

  const batchPanel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Batch' }) }).first();
  await expect(batchPanel.getByRole('heading', { name: 'Batch', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'performance-01.pdf' })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByText('Text box added to page.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply to all' }).click();
  await expect(page.getByRole('dialog', { name: 'Replace existing placements?' })).toBeVisible();
  await page.getByRole('button', { name: 'Replace and apply' }).click();
  await expect(page.getByText('Applied to 19 documents.')).toBeVisible();
  await expect.poll(async () => batchPanel.locator('span').filter({ hasText: 'Placed' }).count()).toBe(DOCUMENT_COUNT);

  // Let the initial PDF page/thumbnail paints settle before measuring the
  // worker-backed batch operation. Those paints belong to editing readiness,
  // not flatten+zip responsiveness, and otherwise make the measurement
  // nondeterministic on a cold production preview.
  await page.waitForTimeout(1500);

  const observerReady = await page.evaluate(() => {
    const longTasks: number[] = [];
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      const observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: 'longtask' });
      (window as Window & { __signliteLongTasks?: number[]; __signliteObserver?: PerformanceObserver }).__signliteLongTasks = longTasks;
      (window as Window & { __signliteObserver?: PerformanceObserver }).__signliteObserver = observer;
      return true;
    }
    return false;
  });

  const startedAt = Date.now();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all' }).click();
  const download = await downloadPromise;
  const elapsedMs = Date.now() - startedAt;
  await expect(page.getByText('Done. 20 documents signed.')).toBeVisible({ timeout: MAX_BATCH_MS });
  const batchWindow = await page.evaluate(() => {
    const state = window as Window & { __signliteLongTasks?: number[]; __signliteObserver?: PerformanceObserver };
    state.__signliteObserver?.disconnect();
    const start = performance.getEntriesByName('signlite:batch-processing-start', 'mark').at(-1)?.startTime ?? 0;
    const end = performance.getEntriesByName('signlite:batch-processing-end', 'mark').at(-1)?.startTime ?? performance.now();
    const entries = performance.getEntriesByType('longtask')
      .filter((entry) => entry.startTime >= start && entry.startTime <= end)
      .map((entry) => entry.duration);
    return { start, end, longTasks: entries };
  });
  const longTasks = batchWindow.longTasks;

  const maxLongTaskMs = longTasks.length > 0 ? Math.max(...longTasks) : 0;
  await test.info().attach('batch-performance-result.json', {
    body: JSON.stringify({
      documentCount: DOCUMENT_COUNT,
      pageCount: DOCUMENT_COUNT * 10,
      elapsedMs,
      batchProcessingMs: Math.round(batchWindow.end - batchWindow.start),
      maxLongTaskMs,
      longTasks
    }, null, 2),
    contentType: 'application/json'
  });

  expect(download.suggestedFilename()).toMatch(/^signlite-batch-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(elapsedMs).toBeLessThan(MAX_BATCH_MS);
  expect(longTasks.filter((duration) => duration > 50)).toEqual([]);
  expect(observerReady).toBe(true);
});
