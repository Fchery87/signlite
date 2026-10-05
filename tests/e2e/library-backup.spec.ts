import { writeTempFixture } from './helpers/tmp';
import { expect, test, type Page } from '@playwright/test';
import { createSamplePdf } from './helpers/fixtures';

const FONT_NOT_READY = 'Fonts are still loading. Try again in a moment.';

async function intakeAndOpenEditor(page: Page) {
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'library-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: await createSamplePdf()
  });
  await expect(page.getByRole('heading', { name: 'library-fixture.pdf' })).toBeVisible();
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
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  Buffer.from('IHDR', 'ascii').copy(header, 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  const filler = Buffer.alloc(fillerBytes, 0x42);
  const iend = Buffer.alloc(12);
  Buffer.from('IEND', 'ascii').copy(iend, 4);
  return Buffer.concat([header, filler, iend]);
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
    await intakeAndOpenEditor(page);

    // A realistic multi-megabyte PNG imports successfully.
    const bigPng = pngFile(2000, 1500, 3 * 1024 * 1024);
    await page.setInputFiles('input[accept="application/json"]', {
      name: 'big.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('big-png', bigPng)] }))
    });
    await expect(page.getByText('Added 1. Skipped 0 duplicates.')).toBeVisible();

    const rejections: Array<[string, Buffer]> = [
      ['invalid-image.json', Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('bad-bytes', Buffer.alloc(64, 7))] }))],
      ['truncated.json', Buffer.from(JSON.stringify({
        version: 1,
        signatures: [envelopeEntry('truncated', pngFile(100, 50, 32), { pngBytes: pngFile(100, 50, 32).toString('base64').slice(0, -4) })]
      }))],
      ['zero-dims.json', Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('zero', pngFile(1, 1, 32), { width: 0, height: 0 })] }))],
      ['extreme-dims.json', Buffer.from(JSON.stringify({ version: 1, signatures: [envelopeEntry('extreme', pngFile(5000, 10, 32))] }))],
      ['conflict.json', Buffer.from(JSON.stringify({
        version: 1,
        signatures: [envelopeEntry('big-png', bigPng), envelopeEntry('big-png', pngFile(100, 50, 32))]
      }))]
    ];
    for (const [name, buffer] of rejections) {
      await page.setInputFiles('input[accept="application/json"]', { name, mimeType: 'application/json', buffer });
      await expect(page.getByText("This isn't a SignLite library file.").first()).toBeVisible();
    }
    // Identical duplicates are counted, not written twice.
    const same = envelopeEntry('dup', pngFile(100, 50, 32));
    await page.setInputFiles('input[accept="application/json"]', {
      name: 'dup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, signatures: [same, { ...same }] }))
    });
    await expect(page.getByText('Added 1. Skipped 1 duplicates.')).toBeVisible();

    // A file above the JSON byte limit is refused on size alone.
    const hugePath = await writeTempFixture('huge.json', Buffer.alloc(64 * 1024 * 1024 + 1));
    await page.setInputFiles('input[accept="application/json"]', hugePath);
    await expect(page.getByText('This library file is too large (limit 64 MB).')).toBeVisible();

    expect((await storedAssets(page)).length).toBe(2);
  });

  test('delayed font loading blocks typed saves until fonts verify', async ({ page }) => {
    test.setTimeout(120000);
    let fontsBlocked = true;
    await page.route('**/fonts/*.ttf', (route) => (fontsBlocked ? route.abort() : route.continue()));
    await page.goto('/');
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
    expect((await storedAssets(page)).length).toBe(0);

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

