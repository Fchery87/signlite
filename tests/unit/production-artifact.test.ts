import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProductionReceipt,
  verifyProductionArtifact
} from '../../scripts/production-artifact.mjs';

const temporaryDirectories: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'signlite-artifact-'));
  temporaryDirectories.push(root);
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<h1>SignLite</h1>');
  await writeFile(join(dist, 'assets', 'app.js'), 'console.log("ok")');
  const receipt = await createProductionReceipt(dist, 'abc123');
  return { dist, receipt };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('production artifact receipt', () => {
  it('rejects symlinks instead of excluding them from the verified file set', async () => {
    const { dist, receipt } = await fixture();
    await symlink('index.html', join(dist, 'unchecked-link'));
    await expect(verifyProductionArtifact(dist, receipt, 'abc123')).rejects.toThrow('unsupported artifact entry');
  });

  it('rejects an empty receipt even for an empty directory', async () => {
    const { dist } = await fixture();
    await rm(join(dist, 'index.html'));
    await rm(join(dist, 'assets'), { recursive: true });
    await expect(verifyProductionArtifact(dist, { version: 1, commit: 'abc123', fileHashes: {} }, 'abc123')).rejects.toThrow('index.html');
  });

  it('accepts the exact file set, hashes, and commit', async () => {
    const { dist, receipt } = await fixture();
    await expect(verifyProductionArtifact(dist, receipt, 'abc123')).resolves.toEqual({ fileCount: 2, commit: 'abc123' });
  });

  it('rejects a modified byte', async () => {
    const { dist, receipt } = await fixture();
    await writeFile(join(dist, 'index.html'), '<h1>SignLite!</h1>');
    await expect(verifyProductionArtifact(dist, receipt, 'abc123')).rejects.toThrow('SHA-256 mismatch for index.html');
  });

  it('rejects a missing file', async () => {
    const { dist, receipt } = await fixture();
    await rm(join(dist, 'assets', 'app.js'));
    await expect(verifyProductionArtifact(dist, receipt, 'abc123')).rejects.toThrow('missing file: assets/app.js');
  });

  it('rejects an extra file', async () => {
    const { dist, receipt } = await fixture();
    await writeFile(join(dist, 'extra.txt'), 'unexpected');
    await expect(verifyProductionArtifact(dist, receipt, 'abc123')).rejects.toThrow('unexpected file: extra.txt');
  });

  it('rejects the wrong commit', async () => {
    const { dist, receipt } = await fixture();
    await expect(verifyProductionArtifact(dist, receipt, 'def456')).rejects.toThrow('receipt commit abc123 does not match expected commit def456');
  });

  it('rejects malformed hash entries', async () => {
    const { dist, receipt } = await fixture();
    const malformed = { ...receipt, fileHashes: { 'index.html': createHash('sha256').update('x').digest('hex'), '../escape': '0'.repeat(64) } };
    await expect(verifyProductionArtifact(dist, malformed, 'abc123')).rejects.toThrow('invalid receipt path');
  });

  it('keeps the serialized receipt outside the published directory', async () => {
    const { dist, receipt } = await fixture();
    const receiptPath = join(dist, '..', 'artifact-manifest.json');
    await writeFile(receiptPath, JSON.stringify(receipt));
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toEqual(receipt);
    await expect(readFile(join(dist, 'artifact-manifest.json'), 'utf8')).rejects.toThrow();
  });
});
