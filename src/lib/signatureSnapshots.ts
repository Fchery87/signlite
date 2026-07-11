import type { SignatureAsset, SignatureSnapshot } from '../db/schema';

type SnapshotSource = Pick<SignatureAsset, 'kind' | 'pngBytes' | 'width' | 'height'> &
  Partial<Pick<SignatureAsset, 'label' | 'lastUsedAt'>>;

function encodeDimension(value: number) {
  return new TextEncoder().encode(String(value));
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Creates an immutable, content-addressed copy. Library labels and usage metadata are intentionally excluded. */
export async function createSignatureSnapshot(source: SnapshotSource): Promise<SignatureSnapshot> {
  const kind = new TextEncoder().encode(source.kind);
  const width = encodeDimension(source.width);
  const height = encodeDimension(source.height);
  const image = new Uint8Array(source.pngBytes);
  const content = new Uint8Array(kind.length + width.length + height.length + image.length + 3);
  let offset = 0;
  for (const part of [kind, width, height, image]) {
    content.set(part, offset);
    offset += part.length;
    if (offset < content.length) content[offset++] = 0;
  }
  const digest = await crypto.subtle.digest('SHA-256', content);
  return {
    id: `sha256-${toHex(digest)}`,
    kind: source.kind,
    pngBytes: source.pngBytes.slice(0),
    width: source.width,
    height: source.height
  };
}
