import { describe, expect, it } from 'vitest';
import { createPrecacheManifest, renderServiceWorker } from '../../scripts/pwa-build.mjs';

describe('public app precache', () => {
  it('includes lazy chunks and fonts but excludes metadata, source maps and private paths', () => {
    const files = new Map([
      ['index.html', 'app'], ['assets/lazy-abc.js', 'lazy'], ['fonts/font.ttf', 'font'],
      ['cmaps/abc.bcmap', 'map'], ['standard_fonts/a.pfb', 'font'], ['assets/pdf.worker.mjs', 'worker'],
      ['_headers', 'headers'], ['.vite/manifest.json', '{}'], ['assets/a.js.map', 'source'],
      ['uploads/private.pdf', 'private'], ['sw.js', 'old worker']
    ]);
    const result = createPrecacheManifest(files);
    expect(result.urls).toEqual(['/assets/lazy-abc.js', '/assets/pdf.worker.mjs', '/cmaps/abc.bcmap', '/fonts/font.ttf', '/index.html', '/standard_fonts/a.pfb']);
    expect(createPrecacheManifest(new Map([...files, ['assets/lazy-abc.js', 'changed']])).version).not.toBe(result.version);
  });
  it('worker only serves exact allowlisted GETs and never caches runtime requests or forces activation', () => {
    const worker = renderServiceWorker({ version: 'test', urls: ['/index.html', '/assets/app.js'] });
    expect(worker).toContain('request.method !==');
    expect(worker).toContain('url.search');
    expect(worker).not.toContain('skipWaiting');
    expect(worker).not.toContain('clients.claim');
    expect(worker).not.toContain('cache.put');
  });
});
