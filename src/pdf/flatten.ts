import { format } from 'date-fns';
import { degrees, PDFDocument, rgb } from 'pdf-lib';
import type { Placement, SessionDocument, SignatureAsset, SignatureSnapshotMap } from '../db/schema';
import { getAsset, getDateFormat } from '../db/signatures';
import { STRINGS } from '../lib/strings';
import { collectAssetIds, type FlattenAssetMap } from './assets';
import { normalizedToPdf, pdfPointFromViewer, viewerRectToPdf } from './coords';
import { findUnsupportedCharacters, getEmbeddedFontBytes, layoutText, TEXT_PADDING } from './textLayout';

export { collectAssetIds };

export type AssetLookup = (id: string) => Promise<SignatureAsset | null>;

type FlattenOptions = {
  snapshots?: SignatureSnapshotMap;
  assetMap?: FlattenAssetMap;
  dateFormat?: string;
  loadAsset?: AssetLookup;
  /** One instant shared by every date in this attempt. The batch caller passes
   *  the attempt's start so a midnight crossing cannot make documents in the
   *  same batch disagree. */
  resolvedAt?: number;
};

function getPlacementText(value: string | undefined, fallback: string) {
  const text = (value ?? fallback).trim();
  return text.length > 0 ? text : null;
}

/** The text a placement will export with, including its date resolution.
 *  Both the pre-export coverage check and the flatten call use this so a
 *  placement cannot pass one and fail the other. */
export function resolvePlacementText(placement: Placement, options: FlattenOptions): string | null {
  const raw = placement.type === 'date' ? getPlacementText(placement.value, options.dateFormat ?? getDateFormat()) : getPlacementText(placement.value, '');
  if (!raw) return null;
  return placement.type === 'date' ? format(new Date(options.resolvedAt ?? Date.now()), raw) : raw;
}

async function resolveAssetBytes(placement: Placement, options: FlattenOptions) {
  if (placement.snapshotId) {
    const snapshot = options.snapshots?.[placement.snapshotId];
    if (!snapshot) {
      throw new Error(`Missing snapshot ${placement.snapshotId} for placement ${placement.id}`);
    }
    return snapshot.pngBytes;
  }

  if (placement.assetId && options.assetMap?.[placement.assetId]) {
    return options.assetMap[placement.assetId];
  }

  if (placement.assetId) {
    const loadAsset = options.loadAsset ?? getAsset;
    const asset = await loadAsset(placement.assetId);
    if (asset?.pngBytes) {
      return asset.pngBytes;
    }
  }

  return placement.assetPngBytes ?? null;
}

/** Every placement's export text in one pass, for the pre-flight coverage
 *  check. Rejects before any document is opened for writing. */
export function placementsText(document: SessionDocument, options: FlattenOptions): string[] {
  return document.placements
    .filter((placement) => placement.type === 'text' || placement.type === 'date')
    .map((placement) => resolvePlacementText(placement, options))
    .filter((text): text is string => text !== null);
}

/** Refuses to export text the bundled font cannot draw, with a message naming
 *  the characters. Runs before any document is opened for writing so the failure
 *  is a specific pre-export message rather than a masked write failure. */
export async function assertTextExportable(document: SessionDocument, options: FlattenOptions = {}) {
  for (const text of placementsText(document, options)) {
    const unsupported = await findUnsupportedCharacters(text);
    if (unsupported.length > 0) {
      throw new Error(STRINGS.editor.unsupportedCharacters(unsupported.join(' ')));
    }
  }
}

export async function flattenDocument(document: SessionDocument, options: FlattenOptions = {}): Promise<Uint8Array> {
  try {
    const [pdf, fontBytes] = await Promise.all([PDFDocument.load(document.pdfBytes.slice(0)), getEmbeddedFontBytes()]);
    pdf.registerFontkit((await import('@pdf-lib/fontkit')).default);
    // Subsetted: the font carries Greek and Cyrillic that most exports never
    // draw, and the full face would add ~480 KB to every output document.
    // Measured: subset saves a one-line document at ~5.6 KB; passing customName
    // silently disables subsetting and forces the full face back in.
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const dateFormat = options.dateFormat ?? getDateFormat();
    const attemptOptions = { ...options, dateFormat };

    for (const placement of document.placements) {
      const page = pdf.getPage(placement.pageIndex);
      if (!page) continue;

      const geometry = document.pageGeometry?.[placement.pageIndex];

      if (placement.type === 'signature' || placement.type === 'initials') {
        const pngBytes = await resolveAssetBytes(placement, options);
        if (!pngBytes) continue;
        const image = await pdf.embedPng(pngBytes);
        if (geometry) {
          // The preview letterboxes the image inside the box (object-contain),
          // centering the aspect-preserving inner rect on both axes; the export
          // must center identically, not bottom-align into the box. One anchor
          // point is mapped for both coordinates — for rotated pages the
          // transform swaps axes, so x and y must come from the same point.
          const boxW = (placement.w * geometry.width) / geometry.userUnit;
          const boxH = (placement.h * geometry.height) / geometry.userUnit;
          const fit = Math.min(boxW / image.width, boxH / image.height);
          const drawW = image.width * fit;
          const drawH = image.height * fit;
          // Centering insets are computed in viewer points: the anchor is the
          // drawn rectangle's bottom edge, not the box's.
          const boxHViewer = placement.h * geometry.height;
          const drawHViewer = drawH * geometry.userUnit;
          const bottomViewer =
            (placement.y + placement.h) * geometry.height - (boxHViewer - drawHViewer) / 2;
          const anchor = pdfPointFromViewer(
            (placement.x + (placement.w - (drawW * geometry.userUnit) / geometry.width) / 2) * geometry.width,
            bottomViewer,
            geometry
          );
          const { rotation } = viewerRectToPdf(placement, geometry);
          page.drawImage(image, {
            x: anchor.x,
            y: anchor.y,
            width: drawW,
            height: drawH,
            rotate: degrees(rotation)
          });
          continue;
        }
        const { width, height } = page.getSize();
        const rect = normalizedToPdf(placement, { w: width, h: height });
        const fit = Math.min(rect.w / image.width, rect.h / image.height);
        page.drawImage(image, {
          x: rect.x + (rect.w - image.width * fit) / 2,
          y: rect.y + (rect.h - image.height * fit) / 2,
          width: image.width * fit,
          height: image.height * fit
        });
        continue;
      }

      const text = resolvePlacementText(placement, attemptOptions);
      if (!text) continue;

      const fontSize = Math.max(8, placement.fontSize ?? 12);
      const usableWidth = placement.w * (geometry?.width ?? 0) - TEXT_PADDING.x * 2;
      // The preview clips at the box bottom, so the export must drop the same
      // lines rather than drawing past the placement onto the page below.
      const usableHeight = placement.h * (geometry?.height ?? 0) - TEXT_PADDING.y * 2;
      const layout = await layoutText(text, {
        fontSize,
        maxWidthPx: Math.max(usableWidth, fontSize),
        maxHeightPx: Math.max(usableHeight, fontSize)
      });

      if (geometry) {
        const { rotation } = viewerRectToPdf(placement, geometry);
        const size = fontSize / geometry.userUnit;
        // Each baseline is mapped through the page transform independently:
        // "down in viewer space" is only -y in PDF space on unrotated pages.
        layout.lines.forEach((line, index) => {
          const viewerY = placement.y * geometry.height + TEXT_PADDING.y + layout.firstBaselinePx + index * layout.lineHeightPx;
          const baseline = pdfPointFromViewer(placement.x * geometry.width + TEXT_PADDING.x, viewerY, geometry);
          page.drawText(line.text, {
            x: baseline.x,
            y: baseline.y,
            size,
            font,
            rotate: degrees(rotation),
            color: rgb(0, 0, 0)
          });
        });
        continue;
      }
      const { width, height } = page.getSize();
      const rect = normalizedToPdf(placement, { w: width, h: height });
      // No geometry means the degraded pre-R02 path: unrotated PDF points, box
      // top at rect.y + rect.h.
      layout.lines.forEach((line, index) => {
        page.drawText(line.text, {
          x: rect.x + TEXT_PADDING.x,
          y: rect.y + rect.h - TEXT_PADDING.y - layout.firstBaselinePx - index * layout.lineHeightPx,
          size: fontSize,
          font,
          color: rgb(0, 0, 0)
        });
      });
    }

    return pdf.save({ useObjectStreams: false });
  } catch {
    throw new Error(STRINGS.editor.writeFailed(document.fileName));
  }
}
