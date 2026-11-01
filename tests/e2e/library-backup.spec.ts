import { writeTempFixture } from './helpers/tmp';
import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { createSamplePdf, openQueuedDocument, waitForRuntimeReady } from './helpers/fixtures';

const FONT_NOT_READY = 'Fonts are still loading. Try again in a moment.';

async function intakeAndOpenEditor(page: Page) {
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'library-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await openQueuedDocument(page, 'library-fixture.pdf');
}

type StoredAsset = { id: string; pngBytes: number[]; label: string; width: number; height: number };


async function storedAssets(page: Page): Promise<StoredAsset[]> {
  return await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('signlite');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('signatures', 'readonly');
    const all = await new Promise<Record<string, unknown>[]>((resolve) => {
      const r = tx.objectStore('signatures').getAll();
      r.onsuccess = () => resolve(r.result as Record<string, unknown>[]);
    });
    db.close();
    return all.map((row) => ({ ...(row as unknown as StoredAsset), pngBytes: Array.from(new Uint8Array((row as { pngBytes: ArrayBuffer }).pngBytes)) }));
  });
}

async function storedAssetCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('signlite');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('signatures').objectStore('signatures').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

async function clearSiteStorage(page: Page) {
  // CDP clears without waiting on the app's open connections.
  const session = await page.context().newCDPSession(page);
  await session.send('Storage.clearDataForOrigin', {
    origin: 'http://127.0.0.1:4173',
    storageTypes: 'indexeddb,local_storage,session_storage'
  });
  await session.detach();
}

function pngFile(width: number, height: number, fillerBytes: number): Buffer {
  const crc32 = (bytes: Buffer) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('tEXt', Buffer.alloc(fillerBytes)), chunk('IEND', Buffer.alloc(0))]);
}

function envelopeEntry(id: string, png: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'signature',
    source: 'drawn',
    label: id,
    pngBytes: png.toString('base64'),
    width: widthOf(png),
    height: heightOf(png),
    createdAt: 1,
    lastUsedAt: 1,
    ...overrides
  };
}

function widthOf(png: Buffer) { return png.readUInt32BE(16); }
function heightOf(png: Buffer) { return png.readUInt32BE(20); }

test.describe('library backup reliability', () => {
  test('export survives site-storage clearing and restores identical bytes', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await waitForRuntimeReady(page);
    await intakeAndOpenEditor(page);
    await page.getByRole('button', { name: 'Add library item' }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByPlaceholder('Type your name').fill('Backup Owner');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Signature saved.')).toBeVisible();

    const before = await storedAssets(page);
    expect(before.length).toBe(1);
    const beforeBytes = Buffer.from(before[0]!.pngBytes).toString('hex');

    const exportPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    const download = await exportPromise;
    const exportPath = await download.path();
    await expect(page.getByText(/Export offered/)).toBeVisible();

    await clearSiteStorage(page);
    await page.goto('/');
    await waitForRuntimeReady(page);
    // Clearing storage removed the Work Session, so the editor has to be
    // reopened before the library panel (and its backup status) exists.
    await intakeAndOpenEditor(page);
    await expect(page.getByText('No backup yet.')).toBeVisible();
    expect((await storedAssets(page)).length).toBe(0);

    await page.setInputFiles('input[accept="application/json"]', exportPath!);
    await expect(page.getByText('Added 1. Skipped 0 duplicates.')).toBeVisible();

    const after = await storedAssets(page);
    expect(after.length).toBe(1);
    expect(Buffer.from(after[0]!.pngBytes).toString('hex')).toBe(beforeBytes);
    expect(after[0]!.label).toBe('Backup Owner');
  });

  test('import limits and validation reject bad envelopes without touching the library', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await waitForRuntimeReady(page);
    await intakeAndOpenEditor(page);

    // A realistic multi-megabyte PNG imports successfully.
    const bigPng = pngFile(2000, 1500, 3 * 1024 * 1024);
    await page.setInputFiles('input[accept="application/json"]', {
      name: 'big.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('big-png', bigPng)] }))
    });
    await expect(page.getByText('Added 1. Skipped 0 duplicates.')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('input[accept="application/json"]')).toHaveValue('');

    const rejections: Array<[string, Buffer]> = [
      ['invalid-image.json', Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('bad-bytes', Buffer.alloc(64, 7))] }))],
      ['truncated.json', Buffer.from(JSON.stringify({
        version: 1,
        signatures: [envelopeEntry('truncated', pngFile(100, 50, 32), { pngBytes: pngFile(100, 50, 32).toString('base64').slice(0, -4) })]
      }))],
      ['zero-dims.json', Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('zero', pngFile(1, 1, 32), { width: 0, height: 0 })] }))],
      ['extreme-dims.json', Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('extreme', pngFile(5000, 10, 32))] }))],
    ];
    for (const [name, buffer] of rejections) {
      await page.setInputFiles('input[accept="application/json"]', { name, mimeType: 'application/json', buffer });
      await expect(page.getByText("This isn't a SignLite library file.").first()).toBeVisible();
      await expect(page.locator('input[accept="application/json"]')).toHaveValue('');
    }
    await page.setInputFiles('input[accept="application/json"]', {
      name: 'conflict.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('conflicting', pngFile(100, 50, 32)), envelopeEntry('conflicting', pngFile(50, 100, 32))] }))
    });
    await expect(page.getByText('This file has two different signatures with the same ID.')).toBeVisible();
    await expect(page.locator('input[accept="application/json"]')).toHaveValue('');
    // Identical duplicates are counted, not written twice.
    const same = envelopeEntry('dup', pngFile(100, 50, 32));
    await page.setInputFiles('input[accept="application/json"]', {
      name: 'dup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, signatures: [same, { ...same }] }))
    });
    await expect(page.getByText('Added 1. Skipped 1 duplicates.')).toBeVisible();

    expect(await storedAssetCount(page)).toBe(2);
  });

  test('rejects a native file above the JSON byte limit before parsing', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/');
    await waitForRuntimeReady(page);
    await intakeAndOpenEditor(page);
    // Native file transfer is deliberately separate from PNG decoding tests.
    const hugePath = await writeTempFixture('huge.json', Buffer.alloc(64 * 1024 * 1024 + 1));
    await page.setInputFiles('input[accept="application/json"]', hugePath);
    await expect(page.getByText('This library file is too large (limit 64 MB).')).toBeVisible();
    expect(await storedAssetCount(page)).toBe(0);
  });

  test('delayed font loading blocks typed saves until fonts verify', async ({ page }) => {
    test.setTimeout(120000);
    let fontsBlocked = true;
    await page.route('**/fonts/*.ttf', (route) => (fontsBlocked ? route.abort() : route.continue()));
    await page.goto('/');
    await waitForRuntimeReady(page);
    await intakeAndOpenEditor(page);
    await page.evaluate(async () => {
      // Force a cold font cache by touching the FontFaceSet API surface.
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    });

    await page.getByRole('button', { name: 'Add library item' }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByPlaceholder('Type your name').fill('Font Delay');
    await expect(page.getByText(FONT_NOT_READY)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(FONT_NOT_READY).first()).toBeVisible();
    expect(await storedAssetCount(page)).toBe(0);

    fontsBlocked = false;
    await page.getByRole('button', { name: 'Retry font load' }).click();
    // Wait for the preview image, not for the warning to disappear: the warning
    // is also absent while the check is still in flight, so hiding it would pass
    // on a transient state.
    await expect(page.getByAltText('Typed signature preview')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Signature saved.')).toBeVisible();
    expect((await storedAssets(page)).length).toBe(1);
  });
});
