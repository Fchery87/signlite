import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;

async function listRelativeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, resolve(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'))
    .sort();
}

function validateReceipt(receipt) {
  if (!receipt || receipt.version !== 1 || typeof receipt.commit !== 'string' || !receipt.commit) {
    throw new Error('invalid production artifact receipt');
  }
  if (!receipt.fileHashes || typeof receipt.fileHashes !== 'object' || Array.isArray(receipt.fileHashes)) {
    throw new Error('invalid receipt fileHashes');
  }
  for (const [path, hash] of Object.entries(receipt.fileHashes)) {
    if (!path || path.startsWith('/') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error(`invalid receipt path: ${path}`);
    }
    if (typeof hash !== 'string' || !SHA256.test(hash)) throw new Error(`invalid SHA-256 for ${path}`);
  }
}

export async function createProductionReceipt(directory, commit, metadata = {}) {
  const fileHashes = {};
  for (const path of await listRelativeFiles(directory)) {
    fileHashes[path] = createHash('sha256').update(await readFile(resolve(directory, path))).digest('hex');
  }
  return { version: 1, commit, ...metadata, fileHashes };
}

export async function verifyProductionArtifact(directory, receipt, expectedCommit) {
  validateReceipt(receipt);
  if (receipt.commit !== expectedCommit) {
    throw new Error(`receipt commit ${receipt.commit} does not match expected commit ${expectedCommit}`);
  }
  const actual = await listRelativeFiles(directory);
  const expected = Object.keys(receipt.fileHashes).sort();
  for (const path of expected) {
    if (!actual.includes(path)) throw new Error(`missing file: ${path}`);
  }
  for (const path of actual) {
    if (!expected.includes(path)) throw new Error(`unexpected file: ${path}`);
    const hash = createHash('sha256').update(await readFile(resolve(directory, path))).digest('hex');
    if (hash !== receipt.fileHashes[path]) throw new Error(`SHA-256 mismatch for ${path}`);
  }
  return { fileCount: actual.length, commit: receipt.commit };
}
