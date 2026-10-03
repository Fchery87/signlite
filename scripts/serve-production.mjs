import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const host = process.argv[3] ?? '127.0.0.1';

try {
  const entry = await stat(join(dist, 'index.html'));
  if (!entry.isFile()) throw new Error('not a file');
} catch {
  console.error(`No production build found at ${dist}. Run "npm run build" first.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const candidate = normalize(join(dist, pathname));
    if (!candidate.startsWith(dist + sep) && candidate !== dist) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let filePath = candidate;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      if (extname(pathname) === '') {
        filePath = join(dist, 'index.html');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error));
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${dist} at http://${host}:${port}`);
});
