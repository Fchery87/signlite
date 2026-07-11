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

  it('allows only the store adapter to reference WorkSessionEditor', () => {
    const importers = contents.filter(({ source }) => /workSessionEditor/.test(source)).map(({ path }) => path);
    expect(importers).toEqual(['src/stores/session.ts']);
  });

  it('keeps imperative and privileged store capabilities out of production consumers', () => {
    const allowedInternals = new Set(['src/stores/session.ts', 'src/lib/workSessionEditor.ts']);
    const privilegedReferences = contents.filter(({ path, source }) =>
      !allowedInternals.has(path)
      && /(sessionStoreTestHarness|acquireMutationLease|releaseMutationLease|MutationLease)/.test(source));
    const imperativeHookUsers = contents.filter(({ source }) => /useSessionStore\s*(?:\.|\[['"])(?:getState|setState)/.test(source));
    expect(privilegedReferences).toEqual([]);
    expect(imperativeHookUsers).toEqual([]);
  });

  it('keeps persistence coordination out of the application shell', () => {
    const app = contents.find(({ path }) => path === 'src/App.tsx')?.source ?? '';
    expect(app).not.toMatch(/(?:saveSession|clearSession|setTimeout|QuotaExceededError|staleSessionId)/);
    expect(app).toMatch(/useSessionLifecycle/);
  });

  it('has removed legacy durable compatibility actions and direct status setters', () => {
    const forbidden = ['updateDocumentStatus', 'setDocumentBatchError', 'addPlacement', 'replaceSession:'];
    for (const name of forbidden) {
      expect(contents.filter(({ source }) => source.includes(name)).map(({ path }) => path), name).toEqual([]);
    }
  });
});
