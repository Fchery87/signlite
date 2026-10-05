import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist';
import { ROTATED_CROPPED_GEOMETRY, createRotatedCroppedPdf } from './helpers/fixtures';

/**
 * R02 acceptance evidence: the exported PDF must place markers at the same
 * effective page position the preview showed, across zoom levels and device
 * pixel ratios, for a rotated page with a CropBox origin away from (0,0).
 * The expected page transform is pinned to the installed pdfjs-dist behavior.
 */

// Outside test-results/ so Playwright runs cannot wipe the evidence artifacts.
const ARTIFACT_DIR = path.join('artifacts', 'readiness', 'R02');

type PreviewRect = { x: number; y: number; w: number; h: number };

async function createTypedSignature(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add library item' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByPlaceholder('Type your name').fill('Signer Name');
  await expect(page.getByAltText('Typed signature preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Signer Name', { exact: true }).first()).toBeVisible();
}

async function placeSignatureAndReadPreview(page: Page, dropFraction: { x: number; y: number }): Promise<PreviewRect> {
  const layer = page.getByTestId('placement-layer');
  const layerBox = await layer.boundingBox();
  if (!layerBox) {
    throw new Error('Expected placement layer bounds');
  }
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const card = page.locator('article').filter({ has: page.getByText('Signer Name', { exact: true }) }).first();
  const clientX = layerBox.x + dropFraction.x * layerBox.width;
  const clientY = layerBox.y + dropFraction.y * layerBox.height;
  await card.locator('button').first().dispatchEvent('dragstart', { dataTransfer });
  await layer.dispatchEvent('dragover', { dataTransfer, clientX, clientY });
  await layer.dispatchEvent('drop', { dataTransfer, clientX, clientY });
  await expect(page.getByRole('status').filter({ hasText: 'Signature placed on page 1.' })).toBeVisible();

  const button = page.getByRole('main').getByRole('button', { name: 'signature' });
  const readRect = () =>
    button.evaluate((element, layerBox) => {
    // The preview letterboxes the marker inside the placement box
    // (object-contain), so the visible marker is the aspect-preserving inner
    // rect, not the box itself. The export must match what is visible here.
    const img = element.querySelector('img');
    if (!img) {
      return null;
    }
    const box = img.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = box.x + (box.width - w) / 2;
    const y = box.y + (box.height - h) / 2;
      return {
        x: (x - layerBox.x) / layerBox.width,
        y: (y - layerBox.y) / layerBox.height,
        w: w / layerBox.width,
        h: h / layerBox.height
      };
    }, { x: layerBox.x, y: layerBox.y, width: layerBox.width, height: layerBox.height });

  // The placed box settles to the asset's aspect once the image resolves; a
  // measurement taken before that would disagree with the exported document.
  let previous = await readRect();
  await expect
    .poll(async () => {
      const current = await readRect();
      const stable = JSON.stringify(current) === JSON.stringify(previous);
      previous = current;
      return stable;
    }, { timeout: 15000 })
    .toBe(true);
  if (!previous) {
    throw new Error('Expected placed signature wrapper');
  }
  await page.keyboard.press('Escape');
  // Deselect re-renders the placement; measure the settled post-deselect state
  // so the comparison reflects what the export will see.
  await expect
    .poll(async () => {
      const current = await readRect();
      const stable = JSON.stringify(current) === JSON.stringify(previous);
      previous = current;
      return stable;
    }, { timeout: 15000 })
    .toBe(true);
  return previous;
}

async function exportAndSave(page: Page, artifactPath: string): Promise<void> {
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+S`);
  const download = await downloadPromise;
  await download.saveAs(artifactPath);
  await expect(page.getByText(`Done. Downloaded ${download.suggestedFilename()}.`)).toBeVisible();
}

/** Extracts the viewer-space rectangle of the first painted image via pdf.js operator tracing. */
async function extractImageViewerRect(pdfPath: string): Promise<PreviewRect> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const [a, b, c, d, e, f] = viewport.transform;
  const toViewer = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });

  const opList = await page.getOperatorList();
  const compose = (m1: number[], m2: number[]): number[] => [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let imageCtm: number[] | null = null;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm);
    } else if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === pdfjs.OPS.transform) {
      ctm = compose(opList.argsArray[i] as number[], ctm);
    } else if (fn === pdfjs.OPS.paintImageXObject) {
      imageCtm = ctm;
      break;
    }
  }
  await doc.destroy();
  if (!imageCtm) {
    throw new Error('Exported page contains no image marker');
  }
  // The marker is drawn into the unit square by the recorded CTM.
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ].map(([x, y]) => {
    const ux = imageCtm![0] * x + imageCtm![2] * y + imageCtm![4];
    const uy = imageCtm![1] * x + imageCtm![3] * y + imageCtm![5];
    return toViewer(ux, uy);
  });
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

async function runPlacementAndExport(
  page: Page,
  zoomLabel: string,
  dropFraction: { x: number; y: number },
  artifactPath: string
): Promise<PreviewRect> {
  await page.goto('/');
  await expect(page.getByText('Drop a PDF anywhere.')).toBeVisible();
  await page.locator('input[accept="application/pdf"]').setInputFiles({
    name: 'rotated.pdf',
    mimeType: 'application/pdf',
    buffer: await createRotatedCroppedPdf()
  });
  await expect(page.getByRole('heading', { name: 'rotated.pdf' })).toBeVisible();
  await expect(page.getByTestId('placement-layer')).toBeVisible();
  await page.waitForTimeout(1000);

  if (zoomLabel !== 'Fit') {
    await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: zoomLabel }).click();
  }

  await createTypedSignature(page);
  const previewRect = await placeSignatureAndReadPreview(page, dropFraction);
  await exportAndSave(page, artifactPath);
  return previewRect;
}

async function expectExportMatchesPreview(previewRect: PreviewRect, artifactPath: string): Promise<void> {
  const exportedRect = await extractImageViewerRect(artifactPath);
  const expected = {
    x: previewRect.x * ROTATED_CROPPED_GEOMETRY.width,
    y: previewRect.y * ROTATED_CROPPED_GEOMETRY.height,
    w: previewRect.w * ROTATED_CROPPED_GEOMETRY.width,
    h: previewRect.h * ROTATED_CROPPED_GEOMETRY.height
  };
  const tolerance = 1; // one point; allows DOM rounding
  expect(Math.abs(exportedRect.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(exportedRect.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(exportedRect.w - expected.w)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(exportedRect.h - expected.h)).toBeLessThanOrEqual(tolerance);
}

test('exported markers match preview bounds on a rotated cropped page across zoom levels', async ({ page }) => {
  test.setTimeout(180000);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  // The dropped signature is a non-square typed signature; a symmetric drop
  // point would not catch width/height axis swaps.
  const dropFraction = { x: 0.3, y: 0.35 };

  for (const zoomLabel of ['Fit', '100%', '150%']) {
    const artifactPath = path.join(ARTIFACT_DIR, `zoom-${zoomLabel.replace('%', 'pct')}.pdf`);
    const previewRect = await runPlacementAndExport(page, zoomLabel, dropFraction, artifactPath);
    await expectExportMatchesPreview(previewRect, artifactPath);
  }
});

test.use({ deviceScaleFactor: 2 });

test('exported markers match preview bounds at device pixel ratio 2', async ({ page }) => {
  test.setTimeout(120000);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const artifactPath = path.join(ARTIFACT_DIR, 'dpr2-fit.pdf');
  const previewRect = await runPlacementAndExport(page, 'Fit', { x: 0.3, y: 0.35 }, artifactPath);
  await expectExportMatchesPreview(previewRect, artifactPath);
});
