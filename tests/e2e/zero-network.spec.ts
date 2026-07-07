import { test, expect } from '@playwright/test';

const EXPECTED_CSP =
  "default-src 'self'; connect-src 'none'; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

test('ships a production CSP and stays quiet after load', async ({ page }) => {
  const requests: string[] = [];
  let loaded = false;
  page.on('request', (request) => {
    const url = request.url();
    if (!loaded || !/^https?:/i.test(url)) {
      return;
    }

    const parsedUrl = new URL(url);
    const isBundledAsset =
      parsedUrl.origin === 'http://127.0.0.1:4173' &&
      /^(?:\/assets\/.*|\/favicon\.svg|\/fonts\/.*|\/cmaps\/.*|\/standard_fonts\/.*)$/.test(parsedUrl.pathname);
    if (isBundledAsset) {
      return;
    }

    requests.push(`${request.method()} ${url}`);
  });

  await page.goto('/');
  await expect(page).toHaveTitle('SignLite');
  await expect(page.locator('head meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', EXPECTED_CSP);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();

  loaded = true;
  await page.waitForTimeout(3000);
  expect(requests).toEqual([]);
});
