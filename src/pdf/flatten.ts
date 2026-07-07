import { format } from 'date-fns';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Placement, SessionDocument, SignatureAsset } from '../db/schema';
import { getAsset, getDateFormat } from '../db/signatures';
import { STRINGS } from '../lib/strings';
import { collectAssetIds, type FlattenAssetMap } from './assets';
import { normalizedToPdf } from './coords';

export { collectAssetIds };

export type AssetLookup = (id: string) => Promise<SignatureAsset | null>;

type FlattenOptions = {
  assetMap?: FlattenAssetMap;
  dateFormat?: string;
  loadAsset?: AssetLookup;
};

function getPlacementText(value: string | undefined, fallback: string) {
  const text = (value ?? fallback).trim();
  return text.length > 0 ? text : null;
}

async function resolveAssetBytes(placement: Placement, options: FlattenOptions) {
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

      const { width, height } = page.getSize();
      const rect = normalizedToPdf(placement, { w: width, h: height });

      if (placement.type === 'signature' || placement.type === 'initials') {
        const pngBytes = await resolveAssetBytes(placement, options);
        if (!pngBytes) continue;
        const image = await pdf.embedPng(pngBytes);
        page.drawImage(image, rect);
        continue;
      }

      const text = placement.type === 'date' ? getPlacementText(placement.value, dateFormat) : getPlacementText(placement.value, '');

      if (!text) continue;

      const renderedText = placement.type === 'date' ? format(new Date(), text) : text;
      const fontSize = Math.max(8, placement.fontSize ?? 12);
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
