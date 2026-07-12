# Selected-document PDF resource lifetime profile

**Decision:** Do not proceed with a resource manager or an all-document PDF cache.

**Profile date:** 2026-07-11  
**Target:** production Vite build, headless Chromium, local preview server, zero remote requests  
**Source state:** `d9f472c` plus temporary console-only timing probes; probes were removed before this report was committed.

## Repeatable scenario

1. Build with `npm run build` and serve `dist` through `vite preview`.
2. Add temporary `performance.now()` console probes around the selected-document load effect in `EditorView`:
   - immediately before `loadDocument`,
   - after the loaded PDF becomes ready,
   - immediately before `LoadedPdf.destroy()`, and
   - when its promise settles.
3. Launch production Chromium through Playwright and enable CDP `HeapProfiler` and `Runtime`.
4. Create and upload six local PDFs with pdf-lib:
   - one 1-page small PDF,
   - one 30-page text-heavy PDF,
   - four 5-page PDFs.
5. Force garbage collection before each heap sample.
6. Measure intake/first render; select the large document; alternate small/large for six **settled** switches; then perform eight 30 ms **rapid** switches.
7. Cycle Fit, 100%, and 150% zoom.
8. Add a text Placement and complete a single-document signing download.
9. Unmount the editor with Start Fresh, force GC, and measure movement toward baseline.
10. Remove the probes, rebuild, and run the functional/build/zero-network suites.

The scenario intentionally distinguishes settled switching (where every selected PDF reaches ready state) from rapid supersession (where load effects can be cancelled before readiness).

## Decision thresholds

A narrow follow-up would be justified if any production run showed:

- selected-document first render or repeated-switch p95 above **4 seconds** for these local fixtures;
- more than **2 MB** retained-heap growth after settled switching and forced GC;
- more than **1 MB** additional growth after rapid switching;
- destruction completion above **1 second**;
- post-unmount heap remaining more than **1.5 MB** above baseline; or
- monotonic growth across switch cycles.

These are regression thresholds for this reproducible fixture, not general PDF size limits.

## Measurements

| Stage | Used JS heap after GC |
|---|---:|
| Baseline, no PDF | 1.21 MB |
| Small PDF first render | 5.02 MB |
| Large PDF first render | 6.25 MB |
| Six settled switches | 6.67 MB |
| Eight rapid switches | 6.79 MB |
| Fit → 100% → 150% → Fit | 6.85 MB |
| Signing completion | 7.59 MB |
| Editor unmount + GC | 2.13 MB |

- Initial six-document intake plus small selected-document first render: **8.88 s**.
- Large selected-document first render: **2.49 s**.
- Settled repeated-switch latencies: **1.50–3.26 s**; observed maximum **3.26 s**.
- Six settled switches grew retained heap by **0.42 MB** from the first large render.
- Eight rapid switches added **0.12 MB**.
- Signing completion added **0.74 MB** over the post-zoom sample.
- Editor unmount returned to **0.92 MB above baseline**, inside the 1.5 MB threshold.

## Direct destruction observation

Temporary production probes recorded **8 destruction starts and 8 destruction completions** during eight settled selected-document retirements. Each destruction completed before or during the next selected-document load; observed completion time was below **0.4 s**.

The rapid-switch portion recorded load supersession before readiness, as expected. It did not produce monotonic retained-heap growth: the forced-GC sample increased only 0.12 MB and the editor-unmount sample moved back near baseline. This result does not justify a cache or broader ownership module.

## Development vs production

Measurements came from optimized production assets, not the Vite development server. React development diagnostics, Strict Mode behavior, source maps, and dev-server module instrumentation were therefore excluded. The only instrumentation was four console timing probes in a temporary production build; it did not retain PDF objects or alter ownership and was removed afterward.

## Conclusion

Current ownership is sufficient:

- the selected-document effect owns one ready PDF at a time;
- settled retirement calls and completes `LoadedPdf.destroy()` directly;
- page rendering cleans up page resources;
- retained memory plateaus across switching and returns near baseline after editor unmount; and
- all measured latency and memory values remain within the recorded thresholds.

Do **not** add a speculative resource manager or all-document cache. Reopen this decision only if a production fixture exceeds one of the thresholds above or a browser-specific leak is reproduced.
