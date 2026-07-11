import type { SessionDocument } from '../db/schema';

export type FlattenAssetMap = Record<string, ArrayBuffer>;

export function collectAssetIds(documents: Pick<SessionDocument, 'placements'>[]) {
  const ids = new Set<string>();

  for (const document of documents) {
    for (const placement of document.placements) {
      if ((placement.type === 'signature' || placement.type === 'initials') && !placement.snapshotId && placement.assetId) {
        ids.add(placement.assetId);
      }
    }
  }

  return Array.from(ids);
}
