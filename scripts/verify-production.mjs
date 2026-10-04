import { createHash } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
// Outside test-results/ so Playwright runs cannot wipe the receipt.
const receiptDir = resolve(root, 'artifacts', 'readiness', 'R01');

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

const allFiles = await listFiles(dist);
const manifestPath = join(dist, '.vite', 'manifest.json');
const hasManifest = allFiles.includes(manifestPath);
if (!hasManifest) {
  throw new Error('dist/.vite/manifest.json is missing. Build with the Vite manifest enabled.');
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const indexHtml = await readFile(join(dist, 'index.html'), 'utf8');
const htmlScriptSources = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
const htmlStyleSources = [...indexHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]);
if (htmlScriptSources.length === 0) {
  throw new Error('index.html references no module scripts.');
}

const entriesByFile = new Map(Object.values(manifest).map((entry) => [entry.file, entry]));
for (const source of htmlScriptSources) {
  if (!entriesByFile.has(source.replace(/^\//, ''))) {
    throw new Error(`index.html references ${source}, which the build manifest does not describe.`);
  }
}

// Walk static imports once from the HTML-referenced entries. Dynamic imports
// stay lazy by definition and are not part of the initial payload.
const initialJsFiles = new Set();
const initialCssFiles = new Set();
const queue = htmlScriptSources.map((source) => source.replace(/^\//, ''));
while (queue.length > 0) {
  const file = queue.pop();
  if (initialJsFiles.has(file)) continue;
  initialJsFiles.add(file);
  const entry = entriesByFile.get(file);
  if (!entry) throw new Error(`Manifest does not describe ${file}.`);
  for (const imported of entry.imports ?? []) {
    queue.push(manifest[imported].file);
  }
  for (const css of entry.css ?? []) {
    initialCssFiles.add(css);
  }
}
for (const source of htmlStyleSources) {
  const file = source.replace(/^\//, '');
  if (!initialCssFiles.has(file)) {
    throw new Error(`index.html references stylesheet ${source}, which no initial chunk claims.`);
  }
}

const gzipBytes = async (file) => gzipSync(await readFile(join(dist, file))).byteLength;
const initialJsGzip = (await Promise.all([...initialJsFiles].map(gzipBytes))).reduce((total, size) => total + size, 0);
const initialCssGzip = (await Promise.all([...initialCssFiles].map(gzipBytes))).reduce((total, size) => total + size, 0);

if (initialJsGzip >= 300 * 1024) {
  throw new Error(`Initial JavaScript is ${initialJsGzip} gzip bytes, over the 300 KiB budget.`);
}

if (!indexHtml.includes("connect-src 'none'")) {
  throw new Error("Production index.html is missing connect-src 'none'.");
}

const commitSha = (await readFile(resolve(root, '.git', 'HEAD'), 'utf8')).trim();
let headRef = null;
if (commitSha.startsWith('ref: ')) {
  headRef = commitSha.slice(5).trim();
}
const resolveSha = async (refPath) => {
  try {
    const content = (await readFile(resolve(root, '.git', refPath), 'utf8')).trim();
    return content.startsWith('ref: ') ? await resolveSha(content.slice(5)) : content;
  } catch {
    return null;
  }
};
const commit = headRef ? await resolveSha(headRef) : commitSha;

const hashes = {};
for (const file of allFiles) {
  if (file.startsWith(join(dist, '.vite'))) continue;
  const bytes = await readFile(file);
  hashes[relative(dist, file).split(sep).join('/')] = createHash('sha256').update(bytes).digest('hex');
}

const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir(receiptDir, { recursive: true });
await writeFile(
  join(receiptDir, 'artifact-manifest.json'),
  JSON.stringify({ commit, initialJsFiles: [...initialJsFiles].sort(), initialJsGzip, initialCssGzip, fileHashes: hashes }, null, 2)
);

// Keep the published directory free of build-only metadata.
await rm(join(dist, '.vite'), { recursive: true, force: true });

console.log(JSON.stringify({
  initialJsChunks: [...initialJsFiles].sort(),
  initialJsGzipBytes: initialJsGzip,
  initialJsGzipKiB: Math.round(initialJsGzip / 1024),
  initialCssGzipBytes: initialCssGzip,
  manifestResolvedFrom: 'dist/.vite/manifest.json via index.html entry',
  commit,
  receipt: relative(root, join(receiptDir, 'artifact-manifest.json')),
  fileCount: Object.keys(hashes).length
}, null, 2));
