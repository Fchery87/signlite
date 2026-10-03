# Batch performance verification

The repeatable worker fixture in `tests/unit/flatten-worker-performance.test.ts` exercises 20 documents with 10 pages each. It completed in 1,420 ms in this environment with all 20 documents flattened successfully.

The production-preview Playwright fixture in `tests/e2e/batch-performance.spec.ts` exercises the same 20-document batch through the UI. The latest run completed in under 30 seconds in this environment. The benchmark records long tasks only inside the worker-processing interval, excluding the initial PDF page and thumbnail paints. No measured long task exceeded 50 ms during that interval.

These are synthetic-fixture results. They do not replace the real-document gauntlet or the founder's two-minute workflow timing run. Browser hardware, PDF content, and file size can change the result.

## Enforced session limits

- 50 documents per Work Session.
- 500 pages per Work Session.
- 500 MB of source PDF bytes per Work Session.
- 100 MB per PDF file.

The limits are enforced at file intake in `src/lib/files.ts`. The user sees a per-file rejection message when a candidate would exceed a limit.

## Reproduce

```bash
npm run test -- tests/unit/flatten-worker-performance.test.ts
npm run test:e2e -- batch-performance.spec.ts
```

The Playwright test must run against the production preview. It records `batch-performance-result.json` as a test attachment with elapsed time and observed long-task durations.

The production bundle budget is checked after build with:

```bash
npm run build
npm run verify:production
```

The current production build's initial `index` and `ui-vendor` chunks total approximately 64 KiB gzip. PDF rendering and flattening remain lazy chunks.
