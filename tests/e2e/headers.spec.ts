import { expect, test } from '@playwright/test';

test('the served app sends framing and privacy headers', async ({ page, request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const csp = response.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['cache-control']).toBe('no-cache');

  const html = await response.text();
  const script = html.match(/src="(\/assets\/[^"]+\.js)"/);
  expect(script).not.toBeNull();
  const asset = await request.get(script?.[1] ?? '');
  expect(asset.headers()['content-type']).toContain('javascript');
  expect(asset.headers()['cache-control']).toContain('immutable');

  await page.goto('/');
  const framed = await page.evaluate(() => window.self === window.top);
  expect(framed).toBe(true);
});
