import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const publicAsset = /^(?:index\.html|manifest\.webmanifest|favicon\.svg|icons\/[\w.-]+\.(?:png|svg)|(?:assets|fonts|cmaps|standard_fonts)\/[\w./-]+\.(?:m?js|css|ttf|woff2?|bcmap|pfb|otf|png|svg))$/;
export function createPrecacheManifest(files) {
  const hash = createHash('sha256');
  const urls = [...files.keys()].filter((name) => publicAsset.test(name)).sort();
  for (const name of urls) hash.update(name).update(files.get(name));
  return { version: hash.digest('hex').slice(0, 20), urls: urls.map((name) => `/${name}`) };
}
export function renderServiceWorker({ version, urls }) {
  return `/* Generated public app resources only. Never runtime-cache requests. */
const CACHE = 'signlite-app-${version}';
const URLS = ${JSON.stringify(urls)};
const ALLOWED = new Set(URLS);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(URLS.map(url => new Request(url, {cache: 'reload'})));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('signlite-app-') && key !== CACHE).map(key => caches.delete(key)));
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'APP_CACHE_STATUS' && event.ports[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const complete = (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean);
      event.ports[0].postMessage({ready: complete, version: ${JSON.stringify(version)}});
    })());
  }
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.hash) return;
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!ALLOWED.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(path)) || fetch(request);
  })());
});
`;
}
export function pwaBuild() {
  let output;
  return {
    name: 'signlite-public-precache',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    closeBundle: {
      order: 'post',
      async handler() {
        const files = new Map();
        async function walk(dir, prefix = '') {
          for (const entry of await readdir(dir, {withFileTypes: true})) {
            const name = prefix + entry.name;
            if (entry.isDirectory()) await walk(join(dir, entry.name), name + '/');
            else if (entry.isFile()) files.set(name, await readFile(join(dir, entry.name)));
          }
        }
        await walk(output);
        await writeFile(join(output, 'sw.js'), renderServiceWorker(createPrecacheManifest(files)));
      }
    }
  };
}
