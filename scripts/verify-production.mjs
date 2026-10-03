import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const assets = resolve(dist, 'assets');
const names = await readdir(assets);
const initialNames = names.filter((name) => /^(index|ui-vendor)-.*\.js$/.test(name));

if (initialNames.length === 0) {
  throw new Error('No initial application chunks found in dist/assets.');
}

const initialGzipBytes = (await Promise.all(
  initialNames.map(async (name) => gzipSync(await readFile(resolve(assets, name))).byteLength)
)).reduce((total, size) => total + size, 0);

if (initialGzipBytes >= 300 * 1024) {
  throw new Error(`Initial JavaScript is ${initialGzipBytes} gzip bytes, over the 300 KB budget.`);
}

const indexHtml = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!indexHtml.includes("connect-src 'none'")) {
  throw new Error("Production index.html is missing connect-src 'none'.");
}

console.log(JSON.stringify({
  initialChunks: initialNames,
  initialGzipBytes,
  initialGzipKiB: Math.round(initialGzipBytes / 1024),
  csp: 'connect-src none'
}, null, 2));
