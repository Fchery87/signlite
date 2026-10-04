import { format } from 'date-fns';
import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Placement, SessionDocument, SignatureAsset, SignatureSnapshotMap } from '../db/schema';
import { getAsset, getDateFormat } from '../db/signatures';
import { STRINGS } from '../lib/strings';
import { collectAssetIds, type FlattenAssetMap } from './assets';
import { normalizedToPdf, pdfPointFromViewer, viewerRectToPdf } from './coords';

export { collectAssetIds };

export type AssetLookup = (id: string) => Promise<SignatureAsset | null>;

type FlattenOptions = {
  snapshots?: SignatureSnapshotMap;
  assetMap?: FlattenAssetMap;
  dateFormat?: string;
  loadAsset?: AssetLookup;
};

function getPlacementText(value: string | undefined, fallback: string) {
  const text = (value ?? fallback).trim();
  return text.length > 0 ? text : null;
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

export async function flattenDocument(document: SessionDocument, options: FlattenOptions = {}): Promise<Uint8Array> {
  try {
    const pdf = await PDFDocument.load(document.pdfBytes.slice(0));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const dateFormat = options.dateFormat ?? getDateFormat();

    for (const placement of document.placements) {
      const page = pdf.getPage(placement.pageIndex);
      if (!page) continue;

      const geometry = document.pageGeometry?.[placement.pageIndex];

      if (placement.type === 'signature' || placement.type === 'initials') {
        const pngBytes = await resolveAssetBytes(placement, options);
        if (!pngBytes) continue;
        const image = await pdf.embedPng(pngBytes);
        if (geometry) {
          // The anchor is the on-screen bottom-left corner mapped through the
          // page transform; rotate keeps the content upright on the rotated page.
          const anchor = pdfPointFromViewer(placement.x * geometry.width, (placement.y + placement.h) * geometry.height, geometry);
          const { rotation } = viewerRectToPdf(placement, geometry);
          page.drawImage(image, {
            x: anchor.x,
            y: anchor.y,
            width: (placement.w * geometry.width) / geometry.userUnit,
            height: (placement.h * geometry.height) / geometry.userUnit,
            rotate: degrees(rotation)
          });
          continue;
        }
        const { width, height } = page.getSize();
        const rect = normalizedToPdf(placement, { w: width, h: height });
        // drawImage expects width/height; passing the Rect's w/h keys would be
        // silently ignored and the image drawn at its natural size.
        page.drawImage(image, { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
        continue;
      }

      const text = placement.type === 'date' ? getPlacementText(placement.value, dateFormat) : getPlacementText(placement.value, '');

      if (!text) continue;

      const renderedText = placement.type === 'date' ? format(new Date(), text) : text;
      const fontSize = Math.max(8, placement.fontSize ?? 12);
      if (geometry) {
        // Baseline starts one font size below the box top in viewer space, matching the preview.
        const baseline = pdfPointFromViewer(placement.x * geometry.width, (placement.y * geometry.height) + fontSize, geometry);
        const { rotation } = viewerRectToPdf(placement, geometry);
        page.drawText(renderedText, {
          x: baseline.x,
          y: baseline.y,
          size: fontSize / geometry.userUnit,
          font,
          rotate: degrees(rotation),
          color: rgb(0, 0, 0)
        });
        continue;
      }
      const { width, height } = page.getSize();
      const rect = normalizedToPdf(placement, { w: width, h: height });
      page.drawText(renderedText, {
        x: rect.x,
        y: rect.y + Math.max(rect.h - fontSize, 0),
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    }

    return pdf.save({ useObjectStreams: false });
  } catch {
    throw new Error(STRINGS.editor.writeFailed(document.fileName));
  }
}
