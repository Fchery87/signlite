// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { renderServiceWorker } from '../../scripts/pwa-build.mjs';

function worker() {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const addAll = vi.fn().mockResolvedValue(undefined);
  const match = vi.fn().mockResolvedValue(new Response('app'));
  const remove = vi.fn().mockResolvedValue(true);
  const caches = {open: vi.fn().mockResolvedValue({addAll, match}), delete: remove, keys: vi.fn().mockResolvedValue(['signlite-app-old', 'signlite-app-new', 'unrelated-cache'])};
  const fetch = vi.fn();
  runInNewContext(renderServiceWorker({version: 'new', urls: ['/index.html', '/assets/lazy.js']}), {
    self: {location: {origin: 'https://app.test'}, addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler)},
    caches, fetch, URL, Request: class extends Request { constructor(url: string, options?: RequestInit) { super(new URL(url, 'https://app.test'), options); } }, Set, Promise
  });
  return {handlers, caches, addAll, match, remove, fetch};
}
it('installation precaches only the generated public list and activation retains unrelated caches', async () => {
  const sw = worker();
  let done: Promise<unknown> = Promise.resolve();
  sw.handlers.get('install')!({waitUntil: (promise: Promise<unknown>) => {done = promise;}});
  await done;
  expect(sw.addAll.mock.calls[0][0].map((request: Request) => request.url)).toEqual(['https://app.test/index.html', 'https://app.test/assets/lazy.js']);
  sw.handlers.get('activate')!({waitUntil: (promise: Promise<unknown>) => {done = promise;}});
  await done;
  expect(sw.remove).toHaveBeenCalledExactlyOnceWith('signlite-app-old');
});
it('ignores private, cross-origin, blob, query and non-GET requests', () => {
  const sw = worker();
  for (const [url, method] of [
    ['https://app.test/private.pdf', 'GET'], ['https://other.test/assets/lazy.js', 'GET'],
    ['blob:https://app.test/secret', 'GET'], ['https://app.test/assets/lazy.js?user=secret', 'GET'],
    ['https://app.test/assets/lazy.js', 'POST']
  ]) {
    const respondWith = vi.fn();
    sw.handlers.get('fetch')!({request: new Request(url, {method}), respondWith});
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(sw.caches.open).not.toHaveBeenCalled();
});
it('removes an incomplete cache when public precache installation fails', async () => {
  const sw = worker();
  sw.addAll.mockRejectedValueOnce(new Error('storage full'));
  let done: Promise<unknown> = Promise.resolve();
  sw.handlers.get('install')!({waitUntil: (promise: Promise<unknown>) => {done = promise;}});
  await expect(done).rejects.toThrow('storage full');
  expect(sw.remove).toHaveBeenCalledExactlyOnceWith('signlite-app-new');
});
it('serves the public shell from its own version cache without a runtime write', async () => {
  const sw = worker();
  let response: Promise<Response> | undefined;
  sw.handlers.get('fetch')!({request: new Request('https://app.test/'), respondWith: (promise: Promise<Response>) => {response = promise;}});
  expect(await (await response)!.text()).toBe('app');
  expect(sw.caches.open).toHaveBeenCalledWith('signlite-app-new');
  expect(sw.match).toHaveBeenCalledWith('/index.html');
  expect(sw.fetch).not.toHaveBeenCalled();
});
it('repairs only missing allowlisted resources and acknowledges completion', async () => {
  const sw = worker();
  sw.match.mockImplementation(async (url: string) => url === '/index.html' ? undefined : new Response('app'));
  const postMessage = vi.fn();
  let done: Promise<unknown> = Promise.resolve();
  sw.handlers.get('message')!({data: 'APP_CACHE_REPAIR', ports: [{postMessage}], waitUntil: (promise: Promise<unknown>) => {done = promise;}});
  await done;
  expect(sw.addAll).toHaveBeenCalledExactlyOnceWith(['/index.html']);
  expect(postMessage).toHaveBeenCalledWith({ready: true, version: 'new'});
});
it.each(['APP_CACHE_STATUS', 'APP_CACHE_REPAIR'])('responds false instead of rejecting on storage errors for %s', async (message) => {
  const sw = worker();
  sw.match.mockRejectedValueOnce(new Error('storage unavailable'));
  const postMessage = vi.fn();
  let done: Promise<unknown> = Promise.resolve();
  sw.handlers.get('message')!({data: message, ports: [{postMessage}], waitUntil: (promise: Promise<unknown>) => {done = promise;}});
  await expect(done).resolves.toBeUndefined();
  expect(postMessage).toHaveBeenCalledWith({ready: false, version: 'new'});
});
it('responds false when repair fetching fails without rejecting its event lifetime', async () => {
  const sw = worker();
  sw.match.mockResolvedValue(undefined);
  sw.addAll.mockRejectedValueOnce(new Error('offline'));
  const postMessage = vi.fn();
  let done: Promise<unknown> = Promise.resolve();
  sw.handlers.get('message')!({data: 'APP_CACHE_REPAIR', ports: [{postMessage}], waitUntil: (promise: Promise<unknown>) => {done = promise;}});
  await expect(done).resolves.toBeUndefined();
  expect(postMessage).toHaveBeenCalledWith({ready: false, version: 'new'});
});
