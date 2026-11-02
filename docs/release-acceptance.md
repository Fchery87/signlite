# Release acceptance

## Mobile and installable offline extension, 2026-11-02

Implemented and verified the [mobile design](plans/2026-11-02-mobile-pwa-design.md). Production source is through `749fd7f7226357c857acb0b08c6a20fc159bf8d9`, with acceptance-test corrections through `c95309e822c0cff3dce1ebe8ea56e39676b45693`. No production source changed between the tested build and those test-only commits. The artifact verifier recorded 213 public files, 84,137 bytes initial JS gzip and 5,654 bytes CSS gzip. No deployment or public-release promotion was performed.

| Gate | Evidence |
| --- | --- |
| Typecheck, lint, build | `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run verify:production` passed. Build retains existing large-chunk and mixed-import warnings. |
| Complete unit regression | `npm test -- --maxWorkers=2`: **386 passed across 46 files**. Covers pressure/fallback rendering, coalesced samples, single-pointer capture/cancellation, stationary taps, modal focus/scroll ownership, and PWA allowlist, partial installation cleanup, waiting updates and cache repair. |
| Phone signing | **6 passed**, Pixel 7 Chromium 156.0.8078.4 and iPhone 13 WebKit 27.2 emulation. Both complete fresh-document draw/save/place/move/resize/text-edit/page-navigation/download after offline reload, short-landscape drawing, and touch queue selection/reordering/batch signing/ZIP download. No document overflow. Chromium drags use native CDP touch events. WebKit uses touchscreen taps and synthetic Pointer Events for drags with capture stubbed, not a native touch-drag qualification. |
| Pen pressure and rotation | Chromium CDP pen input produces greater raster ink area at higher pressure, saves successfully, and retains exact backing pixels/dimensions on viewport rotation. This is synthetic pen input, not physical stylus acceptance. |
| Persistent offline app | Browser tests verify first install/precache, offline reload and fresh PDF signing, exact public-resource-only cache contents before/after signing, registration failure/retry, and online repair of an evicted app entry. Document `connect-src 'none'` is unchanged. Only the worker has same-origin app-resource fetch permission. Install prompt/manual iOS guidance and waiting-update behavior have unit coverage. |
| Complete browser regression | **54 distinct cases passed against the same built artifact**, split across runs because the 10-minute tool deadline interrupted monolithic runs. The first 30 desktop cases passed before interruption, the remaining desktop groups passed 9 + 9, and phone projects passed 6. This is not a claim of one uninterrupted green full-suite invocation. |
| Native worker update re-audit | One additional Chromium browser case passed using the shipped worker generator on an isolated localhost origin. A new version stays waiting while an old controlled tab retains its unsaved input and controller. Closing that tab permits activation, removes only old SignLite app caches, retains an unrelated cache, and permits offline reload. This verifies native worker lifecycle, not an OS install flow or live deployment. |

Evidence under `$JCODE_SCRATCH_DIR`: `mobile-final-build.log`, `mobile-artifact.log`, `mobile-qualified-unit.log`, `mobile-final-e2e-2.log` (30 passes before deadline), `mobile-remainder.log` (9 passes), `mobile-output.log` (9 passes), and `mobile-qualified.log` (6 passes). `mobile-qualified-results/` contains reviewed phone screenshots. Earlier failed/partial runs are retained: a real stationary-touch raster bug was corrected, an obsolete sidebar assertion was migrated to dialogs, and IndexedDB test assertions were changed to await hydration/completion. Slow-host test timeouts were not represented as product passes.

Post-delivery re-audit evidence: `pwa-lifecycle.log` records the additional native lifecycle pass. Typecheck, lint and diff whitespace checks passed after adding the test. Production code and the previously tested artifact did not change during this re-audit.

### Whole-result feedback loop

The entire result, including earlier mobile work and the native worker follow-up, was rebuilt and revalidated from `d38e04e60ca0e31f9e131646fa44509ec32cb628`. Typecheck, lint, production build, artifact verification and the full **386-test/46-file unit suite passed**. All **55 browser cases** were exercised by the complete deterministic suite shards: **19 passed**, **20 passed**, and **16 passed**. No browser cases were omitted or inferred from the earlier incremental runs. The final successful shard3 includes test-harness corrections only, with no production changes.

The loop initially reported two failures in shard3: native retention exhausted its default 30-second overall budget during multi-tab preparation, and WebKit's immediate post-gesture width read preceded the committed resize layout. Retention now has an explicit 120-second scenario budget and gesture dimensions use condition polling. The next full shard3 run exposed an intermittent Chromium Save tap: instrumentation showed valid canvas ink and pointer/touch events at Save but no browser-generated click. CSS transform and touch-action hypotheses did not fix it. Separating the rapid CDP-injected drag from the next independent tap by two seconds yielded 10/10 successful instrumented saves, so that separation is confined to the test input transport. It is not an application delay or a retry around a failed product assertion. A complete shard3 rerun then reported **16 passed**. Physical-device acceptance remains unverified.

Full-result evidence: background build task `286971y9wm`, `whole-result-unit.log`, `whole-result-shard1.log`, `whole-result-shard2.log`, and `whole-result-shard3-qualified.log`. Earlier failing runs remain in `whole-result-shard3.log` and `whole-result-shard3-final.log`. The rebuilt artifact again has 213 files, 84,137 bytes initial JS gzip, and 5,654 bytes CSS gzip. This replaces reliance on the earlier partial/incremental browser reports with a complete sharded feedback cycle.

### Additional drawing and persistence boundaries

A subsequent targeted run passed **12 browser cases** against the same, unchanged production artifact: two drawing cases, four native PWA cases, and all six phone cases across Chromium and WebKit emulation. This adds one new case to the suite, not a second full-suite run. The new native Chromium touch case checks uniform backing mapping after resizing an empty portrait pad, exact backing dimensions/pixels across an active-gesture viewport resize, touch cancellation followed by undo, empty raster/disabled Save after undo and clear, a fresh stationary tap after cancellation, and closing without adding a library asset. The pen case now also verifies both injected pressure magnitudes in native IndexedDB and exact PNG/stroke-data persistence after page reload. No production defect was reproduced or production code changed.

The drawing/PWA unit subset passed **24 tests across five files**, including manual iOS installation guidance. Typecheck and lint passed after the final test changes. An attempted repeat of `npm run verify:production` failed because that build-time receipt generator deliberately removes `.vite/manifest.json` after its first successful run. The appropriate read-only checker, `node scripts/check-production-artifact.mjs dist artifact-manifest.json d38e04e60ca0e31f9e131646fa44509ec32cb628`, then verified all **213 files** against the original receipt. No rebuild or mutation of the artifact occurred during this additional run. Evidence under `$JCODE_SCRATCH_DIR`: `extra-boundaries.log` (initial six-case run), `extra-boundaries-final.log` (final 12 passes), `extra-boundary-final-results/`, `extra-boundary-unit-static.log`, and `extra-boundary-artifact.log`. The failed repeat-generator invocation is retained in background task `7425896q5h`.

Emulation is not physical-device or real-stylus acceptance. Synthetic pressure does not qualify hardware pressure or palm rejection. OS-level installation, physical phones/tablets/styluses, Firefox, full Safari acceptance, screen readers, target-hardware performance, real documents, and live-origin behavior require independently recorded evidence. WebKit emulation is the scope tested here, not every Safari platform. Browser storage can be evicted, installation requires HTTPS or localhost, and offline use requires a completed initial app download. Updates wait for all SignLite tabs to close, never forcing a reload during signing. Owner gates below remain open.

### Concurrent touch ownership re-audit

One further native Chromium CDP case verifies that a simultaneous secondary contact adds no ink, releasing that secondary contact does not stop the primary stroke, and a later independent tap creates a separately undoable stroke. Two Undo actions clear the two intended strokes and disable Save. All three drawing cases (cancellation/geometry, concurrent contacts, and pressure/persistence) then passed three repetitions each: **9 passed**. This adds one distinct case, not nine distinct cases or another full-suite qualification. Typecheck, lint and whitespace checks passed. The unchanged 213-file artifact was checked against its original receipt. Only tests and this evidence changed.

Initial runs exposed two test-transport mistakes, not application fixes. A redundant `touchCancel` after the completed stream was rejected by CDP. After removing it, the new case still retained ink after two Undo actions. Native instrumentation confirmed both Undo clicks arrived, ruling out click suppression. Pointer identity tracing showed the test's partial `touchEnd` listed the remaining primary contact, but CDP treats that list as the contacts to release. The next injected move consequently created a new primary pointer and a third stroke. Listing the secondary contact to release corrected the gesture. No assertion was weakened, no extra Undo or application delay was added, and the complete drawing group passed three repetitions afterward. This is concurrent synthetic touch ownership evidence, not hardware palm rejection.

Evidence under `$JCODE_SCRATCH_DIR`: `concurrent-touch.log` (initial cleanup failure), `concurrent-touch-qualified.log` (six existing passes and three new-case failures), `concurrent-touch-instrumented.log` (Undo delivery), `concurrent-touch-identity.log` (pointer identity root cause), `concurrent-touch-final.log` (nine final passes), `concurrent-touch-final-results/`, and `concurrent-touch-static.log` (final static checks).

## Browser hardening qualification, 2026-11-01

### Additional failure-boundary qualification

Current implementation qualification is `919ef208a883ac1722e8eee82864d82c475bee70`. Additional native-browser transaction-abort injection found an unhandled `AbortError` from the import transaction's completion promise, even though rollback and retry were atomic. The import path now observes `tx.done` immediately while retaining its final rejection semantics. Permanent `failure-delivery.spec.ts` checks actual abort injection, zero partial assets/counter increments, successful retry and zero page errors. It also checks cyclic PDF policy failure produces no download, no false signed status and no mutation of stored source bytes.

After this fix, typecheck/lint, **356 unit tests across 43 files**, build/verifier/exact-artifact checker, and **41 Chromium tests** passed. Explicit Node 24.15.0 typecheck, all 20 import unit tests and build passed, and its 209 production files matched the Node 26 artifact exactly after normal build-metadata removal. Earlier full Node 24 unit/browser results below belong to the preceding source revision, not a claim that the new full suite ran twice.

Current tested receipt SHA-256: `43d491f6e68fc3b35a7c919f7403a02a94e19b7705bea8a9f100244031cd3937`. Initial static JS gzip is **72,770 bytes**, CSS gzip **4,421 bytes**, across **209 production files**. Evidence: `import-abort-fix-e2e.log`, `post-abort-full-unit.log`, `post-abort-full-e2e-complete.log`, `post-abort-artifact.log`, `post-abort-node24.log`, and `post-abort-node24-artifact.log` under the scratch implementation directory. The combined unit/build/browser command exceeded the external 600-second task budget after green units/build, so the complete browser suite was rerun separately and passed. That incomplete combined run is not represented as a pass.

Further controls on the preceding qualified revision passed: native no-Web-Locks refusal preserves all stores, native full-clear abort rolls back all stores and permits retry, 40 varied serialized policy graphs preserve benign links and are semantically idempotent, and three repeated native safety/PDF runs passed 27 browser cases. Full-artifact tampering controls rejected corruption, missing/extra files, symlinks, wrong commits and empty receipts. These extend evidence but do not replace owner-only acceptance.

### Initial complete hardening qualification

Scope: controlled desktop-Chromium browser beta. No native application, backend, database migration, live deployment, credential setup, or deletion of real browser data is authorized by this qualification. The approved scope is in `docs/plans/2026-11-01-browser-app-hardening-implementation.md`, with policy and supported-location details in ADR 0003.

Technical qualification passed against implementation commit `3daa9d9e09668069d223443f1ad9e1dbea789d7b`. This is engineer-executable qualification, not owner acceptance or production authorization. The initial fresh baseline had 310 unit passes and 3 timing failures. Its full browser run was externally terminated at 600 seconds. The first integrated browser run had 15 passes, 8 failures, and 13 cases not run. These failures are retained in the implementation logs and are not described as a green baseline.

| Gate | Current evidence |
| --- | --- |
| Exact artifact contract | Standalone Node-built-in checker verifies commit, exact file set, and SHA-256. Receipt stays outside published `dist`. Deploy has no application install or rebuild. Artifact unit tests passed. |
| Storage and lock failure safety | Focused 47-test suite and full Chromium suite passed. Native lock retention preserves exact active/fresh records, single-tab full clear empties all stores without resurrection after reload, refusal preserves work and permits subsequent saving/restoration, and read-only observers do not stop the owner saving. |
| PDF resource adapters | Three Chromium tests passed with self-contained embedded-font CMap fixture, dark-glyph pixel counts, standard-font output, and exact missing-CMap diagnostic. Production factory unit tests exercise actual implementation. |
| Restricted PDF policy | Serialized location matrix and malformed/budget tests passed, 18 policy tests. Flatten and worker tests passed in focused qualification. Browser policy export passed with unchanged source and removed OpenAction. |
| PNG and duplicate imports | 20 focused import tests passed, including real PNG decode/export compatibility, same-size differing bytes, envelope rejection, and concurrent ID collision with one additions-counter increment. Browser backup round-trip passed. |
| Isolated clean install and Node 24 | `npm ci` completed in a disposable source copy without altering working dependencies. Explicit Node 24.15.0 typecheck, lint, Vite build, runtime audit and full-toolchain high-severity gate passed. |
| Complete unit suite | **356 passed across 43 files** with `--maxWorkers=2`, Node 26.13.0/npm 11.20.0. Typecheck and lint passed. Cold normalization runtime initialization is explicit setup rather than consuming the first behavior assertion's timeout. |
| Complete production Chromium suite | **39 passed**, one worker, 1440×900 default viewport. Includes native drag, keyboard download, modal/narrow layout, 20-document batch responsiveness, geometry/text, PNG backup validation, native retention/clearing, restore/read-only, offline retry/signing, restricted policy and zero-network scenarios. |
| Production build and exact artifact | Build, production verifier, deploy gate and standalone checker passed. **209 files**, 72,761 initial static JS gzip bytes and 4,421 CSS gzip bytes. Receipt SHA-256: `be91bad89242938931f340ce3b49cb77dd41d7e9570fb03f0ae9c75865beb597`, for tested implementation commit `3daa9d9e09668069d223443f1ad9e1dbea789d7b`. |

Logs are under `$JCODE_SCRATCH_DIR/signlite-implementation/`. Earlier aggregate qualification commands hit external time limits under substantial local contention. Their partial output remains preserved. Expected jsdom canvas limitations and PDF-library Node-build diagnostics are not globally suppressed. Build chunk-size and existing mixed import warnings remain visible.

Final evidence files: `full-unit-qualified.log`, `final-build.log`, `final-artifact.log`, `final-full-e2e.log`, `audit-runtime-final.log`, `audit-tooling-final.log`, and `clean-node24.log`. Node 24 continuation used its executable directly and completed type/lint/build/audits successfully. Runtime audit reported zero vulnerabilities. Full tooling audit reported 12 moderate package entries and no high/critical findings. Full-suite duration was about five minutes for units and 5.8 minutes for Chromium, but these are contended local execution observations, not product hardware timings.

Runtime audit blocks moderate-or-higher advisories. Tooling blocks high-or-higher advisories. The remaining development-only moderate minimatch advisory family has a maintainer-owned review deadline of 2026-12-01 in `docs/dependency-security-policy.md`. This supersedes the old development-high disposition below, not its historical record.

### Owner-only gates remain open

- Private representative document gauntlet, including forms, scanned/text-heavy/multilingual and already digitally signed PDFs.
- Intended-hardware cold readiness, first page, single/batch export, and memory measurements. Synthetic local timing is not target-hardware acceptance.
- Real screen-reader validation. Keyboard tests do not establish accessibility conformance.
- Authorized live origin: HTTPS/HSTS/CSP/framing/MIME/referrer headers, exact artifact identity and rollback checks.
- Genuine daily-driver entries and 30-day use. The existing log is not backfilled.
- Licensing and production credentials remain owner decisions.

Close/reload all older SignLite tabs before the new maintenance protocol rollout. Old bundles cannot be assumed to cooperate with the origin lock. A static rollback does not roll browser data back. Keep downloaded PDFs and a library backup, which is not a full-session backup. Seven-day inactivity cleanup is best-effort while the app runs, not guaranteed deletion while closed. Storage has no application-level encryption. Visible signatures are not identity verification, and restricted action removal is not comprehensive PDF sanitization.

## Historical qualification, 2026-10-05

Recorded 2026-10-05 against the working tree on `perf/batch-hardening`. This is not a promoted release. Production promotion stays unauthorized until the owner supplies Cloudflare credentials and the target-hardware measurements.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Exported placement geometry within 1 point | VERIFIED in R02 | `docs/readiness/R02.md` |
| Native drag and keyboard download | VERIFIED | `tests/e2e/sign-flow.spec.ts`, `tests/e2e/accessibility.spec.ts` |
| Stale writers refused | VERIFIED in R05 | `docs/readiness/R05.md` |
| Save status tracks the latest revision | VERIFIED in R04 and R05 | `docs/readiness/R04.md`, `docs/readiness/R05.md` |
| Library import keeps valid PNG bytes and rejects invalid ones | VERIFIED in R06 | `docs/readiness/R06.md` |
| Zero requests after Ready to sign offline | VERIFIED in R09 | `docs/readiness/R09.md`, `tests/e2e/zero-network.spec.ts` |
| Intake ceilings | VERIFIED in R03 | `docs/readiness/R03.md` |
| Production artifact is the one CI verified | VERIFIED locally | `.github/workflows/deploy.yml` downloads `production-dist` and does not run `npm run build`. `scripts/check-deploy-gate.mjs` |
| Effective framing headers | VERIFIED against the local production server | `tests/e2e/headers.spec.ts` on 2026-10-05 |
| Live Cloudflare origin | NOT VERIFIED | No `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, or Pages project is configured in this environment. The workflow is ready. The owner runs it. |
| Keyboard dialog and narrow screens | VERIFIED | `tests/unit/modal.test.tsx`, `tests/e2e/accessibility.spec.ts` |
| Clear history keeps signatures | VERIFIED | `tests/unit/local-data.test.ts`, `tests/e2e/local-data.spec.ts` |
| Clear all removes sessions and signatures | VERIFIED | `tests/e2e/local-data.spec.ts` |
| Screen-reader announcement of placements | INCONCLUSIVE | The editor exposes `aria-live="polite"` (`STRINGS.liveRegionLabel`). No screen reader was driven in this run. |
| Shipped runtime advisories | VERIFIED none | `artifacts/readiness/audit-prod-2026-10-05.json` reports zero advisories. |
| Development-tool highs | Disposition recorded, not fixed | `THIRD_PARTY_NOTICES.md`. Follow-up date 2027-01-05. |
| Target-hardware timings | NOT VERIFIED | This machine is not the recorded target. R09 measured one local cold-ready run at 2,802 ms and did not claim the hardware target. |
| Founder document gauntlet | NOT VERIFIED | Private documents stay with the owner. |
| 30-day daily driver | NOT STARTED | `docs/daily-driver-log.md` has the template only. Technical qualification does not start that clock. |

## What the owner still does

1. Replace `LICENSE` if the permissive grant written on 2026-10-05 is not the grant they want. Font notices do not depend on that choice.
2. Create the Cloudflare Pages project, set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_PAGES_PROJECT`, and disable any Git integration on that project so CI is the only publisher.
3. Run the founder document gauntlet and write the sanitized result into this file.
4. Measure cold ready, first page, and a 10-document batch on the target machine. If the browser cannot hold the published 500 MiB ceiling, lower the ceiling in copy, docs, and tests together.
5. Start the daily-driver log with a real entry. Do not backfill days.

## Rollback

R05 records the minimum compatible database version as 1. An older bundle that cannot read the store must stop and ask for a refresh. It must not write. Rolling the site back does not roll browser-local data back.
