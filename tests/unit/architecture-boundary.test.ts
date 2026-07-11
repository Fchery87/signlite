import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('durable Work Session mutation boundary', () => {
  const root = resolve(process.cwd(), 'src');
  const files = sourceFiles(root);
  const contents = files.map((path) => ({ path: relative(process.cwd(), path), source: readFileSync(path, 'utf8') }));

  it('allows only the store adapter to import WorkSessionEditor', () => {
    const importers = contents
      .filter(({ source }) => /from ['"][^'"]*workSessionEditor['"]/.test(source))
      .map(({ path }) => path);
    expect(importers).toEqual(['src/stores/session.ts']);
  });

  it('keeps imperative store capabilities out of production consumers', () => {
    const harnessImporters = contents.filter(({ path, source }) =>
      path !== 'src/stores/session.ts' && /sessionStoreTestHarness/.test(source));
    const imperativeHookUsers = contents.filter(({ source }) => /useSessionStore\.(getState|setState)/.test(source));
    expect(harnessImporters).toEqual([]);
    expect(imperativeHookUsers).toEqual([]);
  });

  it('has removed legacy durable compatibility actions and direct status setters', () => {
    const forbidden = ['updateDocumentStatus', 'setDocumentBatchError', 'addPlacement', 'replaceSession:'];
    for (const name of forbidden) {
      expect(contents.filter(({ source }) => source.includes(name)).map(({ path }) => path), name).toEqual([]);
    }
  });
});
