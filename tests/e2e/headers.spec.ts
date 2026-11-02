import { expect, test } from '@playwright/test';

test('PWA worker permissions stay isolated and install resources are served intact', async ({ request }) => {
  const worker = await request.get('/sw.js?header-check=1');
  expect(worker.ok()).toBe(true);
  expect(worker.headers()['content-type']).toContain('javascript');
  expect(worker.headers()['content-security-policy']).toBe("default-src 'none'; script-src 'self'; connect-src 'self'");
  expect(worker.headers()['service-worker-allowed']).toBe('/');
  expect(worker.headers()['cache-control']).toBe('no-cache');
  expect(worker.headers()['x-content-type-options']).toBe('nosniff');

  for (const path of ['/', '/index.html', '/offline-route']) {
    const document = await request.get(path);
    expect(document.ok()).toBe(true);
    expect(document.headers()['content-security-policy']).toContain("connect-src 'none'");
    expect(document.headers()['cache-control']).toBe('no-cache');
    expect(document.headers()['service-worker-allowed']).toBeUndefined();
  }

  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['cache-control']).toBe('no-cache');
  const manifest: unknown = await manifestResponse.json();
  expect(manifest).toMatchObject({ id: '/', name: 'SignLite', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest).toHaveProperty('icons', [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]);
  for (const size of [192, 512]) {
    const icon = await request.get(`/icons/icon-${size}.png`);
    expect(icon.ok()).toBe(true);
    expect(icon.headers()['content-type']).toBe('image/png');
    const bytes = await icon.body();
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
});

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
