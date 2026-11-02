import { expect, test } from '@playwright/test';
import { createSamplePdf, openQueuedDocument } from './helpers/fixtures';

const offlineReady = (page: import('@playwright/test').Page) => page.getByRole('status').filter({hasText: 'Ready to launch offline'});

test('public app precache supports offline relaunch and a fresh PDF without caching user data', async ({ page, context, request }) => {
  test.setTimeout(180000);
  const headers = await request.get('/sw.js');
  expect(headers.headers()['content-security-policy']).toBe("default-src 'none'; script-src 'self'; connect-src 'self'");
  expect((await request.get('/')).headers()['content-security-policy']).toContain("connect-src 'none'");
  await page.goto('/');
  await expect(offlineReady(page)).toBeVisible({timeout: 90000});
  const resources = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith('signlite-app-'));
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(req => new URL(req.url).pathname)))).flat();
  });
  expect(resources).toContain('/index.html');
  expect(resources.some(path => path.startsWith('/fonts/'))).toBe(true);
  expect(resources.some(path => path.includes('pdf-flatten'))).toBe(true);
  expect(resources.some(path => path.includes('pdf-worker-source'))).toBe(true);
  expect(resources.some(path => path.endsWith('.mjs'))).toBe(true);
  expect(resources.every(path => /^\/(?:index\.html|manifest\.webmanifest|favicon\.svg|icons\/|assets\/|fonts\/|cmaps\/|standard_fonts\/)/.test(path))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(offlineReady(page)).toBeVisible({timeout: 30000});
  await expect(page.getByTestId('runtime-readiness')).toContainText('Ready to sign offline.', {timeout: 60000});
  await page.locator('input[accept="application/pdf"]').setInputFiles({name: 'private-fresh.pdf', mimeType: 'application/pdf', buffer: await createSamplePdf()});
  await openQueuedDocument(page, 'private-fresh.pdf');
  await page.getByRole('button', {name: 'Add library item'}).click();
  await page.getByRole('button', {name: 'Type', exact: true}).click();
  await page.getByPlaceholder('Type your name').fill('Offline Relaunch');
  await expect(page.getByAltText('Typed signature preview')).toBeVisible();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await page.getByRole('button', {name: 'Place on page 1'}).first().click();
  const download = page.waitForEvent('download');
  await page.getByRole('main').getByRole('button', {name: 'Download', exact: true}).click();
  expect((await download).suggestedFilename()).toBe('private-fresh-signed.pdf');
  const after = await page.evaluate(async () => (await Promise.all((await caches.keys()).filter(key => key.startsWith('signlite-app-')).map(async key => (await (await caches.open(key)).keys()).map(req => new URL(req.url).pathname)))).flat());
  expect(after.sort()).toEqual(resources.sort());
});

test('precache failure is visible and retry can prepare offline launch', async ({page}) => {
  test.setTimeout(180000);
  // Inject one registration failure without blocking the app shell or workers.
  await page.addInitScript(() => {
    const real = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    let first = true;
    navigator.serviceWorker.register = (...args) => {
      if (first) { first = false; return Promise.reject(new Error('simulated registration failure')); }
      return real(...args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('status').filter({hasText: 'Offline launch preparation failed'})).toBeVisible();
  await page.getByRole('button', {name: 'Retry offline setup'}).click();
  await expect(offlineReady(page)).toBeVisible({timeout: 90000});
});
