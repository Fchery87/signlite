import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { renderServiceWorker } from '../../scripts/pwa-build.mjs';

test('native PWA update waits for open signing tabs and cleans only old app caches', async ({ context }) => {
  test.setTimeout(120000);
  let version = 'audit-one';
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/sw.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(renderServiceWorker({ version, urls: ['/index.html', '/asset.js'] }));
    } else if (request.url === '/asset.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(`/* public resource ${version} */`);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>PWA lifecycle</title><input aria-label="Unsaved signing note">');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local HTTP address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      await caches.open('unrelated-audit-cache');
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByRole('textbox').fill('Keep this work until I close the tab');
    await page.evaluate(() => {
      Object.defineProperty(window, 'auditController', { value: navigator.serviceWorker.controller });
    });
    version = 'audit-two';
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    expect(await page.evaluate(() => Reflect.get(window, 'auditController') === navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByRole('textbox')).toHaveValue('Keep this work until I close the tab');
    expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([
      'signlite-app-audit-one', 'signlite-app-audit-two', 'unrelated-audit-cache'
    ]));
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(origin);
    await expect.poll(() => reopened.evaluate(() => caches.keys())).toEqual([
      'unrelated-audit-cache', 'signlite-app-audit-two'
    ]);
    await context.setOffline(true);
    await reopened.reload();
    await expect(reopened).toHaveTitle('PWA lifecycle');
    await reopened.close();
  } finally {
    await context.setOffline(false);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
