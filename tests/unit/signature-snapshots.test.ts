import { createSignatureSnapshot } from '../../src/lib/signatureSnapshots';

const bytes = (values: number[]) => new Uint8Array(values).buffer;

describe('createSignatureSnapshot', () => {
  it('derives deterministic identity from image content, kind, and intrinsic dimensions', async () => {
    const first = await createSignatureSnapshot({ kind: 'signature', pngBytes: bytes([1, 2, 3]), width: 20, height: 10 });
    const same = await createSignatureSnapshot({ kind: 'signature', pngBytes: bytes([1, 2, 3]), width: 20, height: 10 });
    const otherKind = await createSignatureSnapshot({ kind: 'initials', pngBytes: bytes([1, 2, 3]), width: 20, height: 10 });
    expect(first.id).toBe(same.id);
    expect(first.id).not.toBe(otherKind.id);
    expect(first.pngBytes).not.toBe(same.pngBytes);
  });

  it('excludes library labels and usage metadata from identity', async () => {
    const asset = { kind: 'signature' as const, pngBytes: bytes([4, 5]), width: 30, height: 12 };
    const first = await createSignatureSnapshot({ ...asset, label: 'Old', lastUsedAt: 1 });
    const renamed = await createSignatureSnapshot({ ...asset, label: 'New', lastUsedAt: 99 });
    expect(first.id).toBe(renamed.id);
  });
});
