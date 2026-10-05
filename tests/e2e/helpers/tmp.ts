import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** Writes an oversized fixture to a temp file and returns its path (Playwright
 *  caps in-memory setInputFiles buffers at 50 MB). */
export async function writeTempFixture(name: string, contents: Buffer): Promise<string> {
  const path = join(tmpdir(), `signlite-e2e-${process.pid}-${name}`);
  await fs.writeFile(path, contents);
  return path;
}
