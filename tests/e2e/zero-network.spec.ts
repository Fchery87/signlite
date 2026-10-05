import { test, expect } from '@playwright/test';
import { createSamplePdf } from './helpers/fixtures';

const EXPECTED_CSP =
  "default-src 'self'; connect-src 'none'; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

test('ships a production CSP, never fetches auxiliary data, and goes quiet after readiness', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!/^https?:/i.test(request.url())) return;
    requests.push(`${request.method()} ${request.url()}`);
  });

  await page.goto('/');
  await expect(page).toHaveTitle('SignLite');
  await expect(page.locator('head meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', EXPECTED_CSP);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');

  // CMaps and standard font data are resident: no path may ever request them,
  // before or after readiness.
  expect(requests.some((url) => /\/cmaps\//.test(url))).toBe(false);
  expect(requests.some((url) => /\/standard_fonts\//.test(url))).toBe(false);

  // Readiness is the boundary: everything before it may load same-origin
  // scripts, styles, fonts, and workers; everything after it must be silent.
  await expect(page.getByTestId('runtime-readiness')).toHaveText('Ready to sign offline.', { timeout: 30000 });
  requests.length = 0;

  await page.waitForTimeout(3000);
  expect(requests).toEqual([]);
});

test('first-use signing after readiness issues no requests', async ({ page }) => {
  const requests: string[] = [];
  let ready = false;
  page.on('request', (request) => {
    if (ready && /^https?:/i.test(request.url())) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('runtime-readiness')).toHaveText('Ready to sign offline.', { timeout: 30000 });
  ready = true;

  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'quiet.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'quiet.pdf' })).toBeVisible();
  await page.waitForTimeout(1500);

  expect(requests).toEqual([]);
});
