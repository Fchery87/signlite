import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyProductionArtifact } from './production-artifact.mjs';

const [distArgument = 'dist', receiptArgument = 'artifact-manifest.json', expectedCommit = process.env.GITHUB_SHA] = process.argv.slice(2);
if (!expectedCommit) {
  throw new Error('expected commit is required as the third argument or GITHUB_SHA');
}
const dist = resolve(distArgument);
const receiptPath = resolve(receiptArgument);
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const result = await verifyProductionArtifact(dist, receipt, expectedCommit);
console.log(`production artifact verified: ${result.fileCount} files for commit ${result.commit}`);
