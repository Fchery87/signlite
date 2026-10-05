# Production readiness implementation plan

> For the implementing agent, use `superpowers:executing-plans` to execute one verified task at a time. This document is the plan, not evidence that the fixes are implemented.

**Goal.** Make SignLite safe to use for local PDF signing and release it through a verified Cloudflare Pages deployment.

**Architecture.** Keep React, Zustand, PDF.js, pdf-lib, and IndexedDB. Preserve `WorkSessionEditor` as the durable mutation boundary and `BatchSigning` as the owner of batch attempts. Put geometry, image validation, storage concurrency, and runtime readiness behind small domain-specific interfaces.

**Stack.** TypeScript, React, Vite, IndexedDB through idb, PDF.js, pdf-lib, Vitest, Playwright, GitHub Actions, and Cloudflare Pages.

**Status.** In progress. Host choice confirmed by the user on October 3, 2026. R01 through R08 are complete with receipts under `docs/readiness/`. Execution continues in plan order.

## How to execute the plan

Read [the production readiness review](../production-readiness-review.md), [the PRD](../prd.md), and [the existing signing consistency decision](../adr/0001-work-session-owns-signing-consistency.md) before editing.

Execute R01 through R13 as the default order. Respect the dependencies in the task table if independent work proceeds in parallel. Treat each task as one reviewable change, split further when its test and implementation cannot fit in a coherent review. Include the regression test and fix in the same mergeable change. Observe the regression failing before applying the fix.

For each task, capture its starting commit and relevant baseline. Run its targeted tests. Exercise its real browser or deployment behavior when specified. Save artifacts under `test-results/readiness/<task-id>/` and record the commands, browser, fixture, and result in the task receipt. Commit only the task's reviewed files. Mark its checkbox complete only when the acceptance evidence exists.

Use the Feature or Bug fix playbook during implementation, as appropriate. Use the figure-it-out workflow for the whole run. Run the repository checks before integration. Do not publish failing regressions to the release branch. Merge and deployment remain separate from local implementation.

### Preserve the current work

- [x] Capture `git status --short`, the tracked diff, and the relevant untracked files before implementation. Preserve the user's current changes and the review report. (Preserved as commit `d6d6b17`.)
- [x] Establish a reproducible implementation baseline in an isolated checkout or worktree. Apply the reviewed working-tree changes there when they belong to the baseline. (The reviewed tree is the baseline commit; later tasks branch from it.)
- [x] Record the exact baseline SHA and applied patch in the execution receipt. Do not assume `HEAD` contains the reviewed scripts and lifecycle changes. (`docs/readiness/R01.md` records baseline `d6d6b17`.)
- [x] Run the baseline checks before changing application behavior. Record known failures without describing them as new regressions. (Baseline lint failure recorded in the R01 receipt.)

### Use the throughput checkpoint

- [ ] Blocking first steps. Finish R01 before implementation fan-out. Capture the PDF and storage baselines before changing their models.
- [ ] Independent workstreams. PDF work and library work may proceed separately after R01. Use separate branches and checkouts.
- [ ] Shared mutable state. Serialize R03, R04, and R05 where they touch the store. Serialize geometry, text, rendering, and readiness integration where they touch PDF runtime files.
- [ ] Smallest safe decomposition. Keep one owner for each task and one integrator. Limit active implementation to two independent tasks. Have another reviewer inspect storage migration and exported-PDF correctness.

## Define the release contract

The following conditions are required for a release candidate.

- [ ] Exported signatures, initials, dates, and text agree with their preview on supported page geometries. Maximum placement error is 1 physical PDF point.
- [ ] Native mouse dragging and a complete keyboard-only signing flow work in supported desktop browsers.
- [ ] No stale writer overwrites or recreates a newer or deleted session. Conflicting local work remains recoverable.
- [ ] Save status describes the latest revision accurately. Startup errors and quota failures remain visible while signing continues where feasible.
- [ ] Library export and import preserve valid PNG bytes. Invalid or oversized imports leave the library unchanged.
- [ ] After **Ready to sign offline** appears, first-time intake, signature creation, editing, single download, and batch download generate zero HTTP requests.
- [ ] Session intake respects 50 documents, 500 pages, 500 MiB of source bytes, and 100 MiB per source PDF. Document these as source-byte ceilings, not a guarantee of total heap size.
- [ ] The production deployment serves the exact artifact that passed CI. Effective HTTP headers enforce the framing and privacy policy.
- [ ] Real-document acceptance, browser checks, performance receipts, and the live-host verification record exist.

Treat the current 500 ms autosave debounce as a scheduling target. It cannot guarantee a 500 ms maximum loss after a process crash or interrupted storage transaction. Preserve pending-edit warnings and describe that limit honestly.

## Schedule the release tasks

| Task | Change | Depends on | Suggested review boundary |
| --- | --- | --- | --- |
| R01 | Repair checks and establish artifact verification | Baseline | Tooling and CI |
| R02 | Correct PDF geometry | R01 | Geometry, intake metadata, export |
| R03 | Fix native dragging and resource intake | R01 | Intake and placement behavior |
| R04 | Make autosave initialization and status reliable | R01 | Lifecycle and app presentation |
| R05 | Prevent stale writes and unsafe history deletion | R04 | IndexedDB migration and ownership |
| R06 | Repair library backup and image boundaries | R01 | Library, image validation, preferences |
| R07 | Dispose PDF resources and serialize rendering | R02, R03 | PDF loading and rendering |
| R08 | Align text layout and support declared scripts | R02 | Shared text model and export |
| R09 | Establish strict offline runtime readiness | R06, R07, R08 | Runtime assets and readiness |
| R10 | Complete accessible controls and privacy management | R03, R04, R05, R06 | UI and local-data actions |
| R11 | Deliver verified artifacts to Cloudflare Pages | R01, R09 | Deployment and headers |
| R12 | Refresh dependencies and include distribution notices | R01, before R13 | Toolchain and notices |
| R13 | Qualify the release candidate | R01 through R12 | Evidence and release documentation |

R12 may start early in an isolated branch. Complete it before the final R09 and R13 verification if its upgrades change PDF.js, fonts, rendering, or the build graph.

R04 delivers standalone startup and status corrections. R05 integrates those states with the guarded repository and returned revision tokens. R11 configures publishing and verifies a preview artifact. Production promotion occurs in R13 only after dependency updates and every prepublication gate pass; canonical-origin acceptance follows promotion.

## R01. Repair checks and test the built artifact

**Findings addressed.** Review finding 5 and the reproducible lint failure.

**Files.** Modify `eslint.config.js`, `package.json`, `playwright.config.ts`, `vite.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, and `scripts/verify-production.mjs`. Create `scripts/serve-production.mjs` if Vite preview cannot serve the exact headers and base paths needed by the tests. Create reusable fixture helpers under `tests/helpers/`.

- [x] Add a scoped Node environment for `scripts/**/*.mjs`. Keep application lint rules enabled. Verify `npm run lint` passes without suppressing `no-undef` globally.
- [x] Pin the same supported Node major in local documentation and both workflows. Use Node 24 as the initial candidate because the reviewed environment uses it. Verify a clean `npm ci` and all tools on that version before adopting it.
- [x] Make Playwright serve an existing `dist/` build in CI. Remove the implicit second build from the browser-test startup command. Preserve an explicit command for developers who need build plus preview.
- [x] Emit a Vite build manifest and have `verify-production.mjs` resolve initial static imports from the HTML entry instead of guessing chunk names. Account for all initial dependencies once. Retain the initial JavaScript budget below 300 KiB gzip.
- [x] Build once, verify `dist/`, and test that directory. Record a file-hash manifest and commit SHA outside the published application directory. (Receipt now at `artifacts/readiness/R01/`; see the R02 receipt for why it left `test-results/`.)
- [x] Make the existing deployment job depend on successful verification until R11 replaces it. Include a test failure in a temporary branch or workflow test fixture and demonstrate that no publish job becomes eligible.
- [x] Extract generated PDF and PNG fixtures that later tasks can use. Keep private real documents outside the repository and CI artifacts.

**Checks.** Run `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=2`, `npm run build`, `npm run verify:production`, and `npm run test:e2e` against the existing artifact.

**Acceptance.** Existing behavior remains green. Renaming an initial chunk or adding a static import cannot evade the size check. Browser tests do not rebuild the artifact. A failing check prevents artifact publication. Record the baseline warning noise and remove inaccurate canvas mocks only where a test needs actual canvas behavior.

## R02. Export placements with the page's effective geometry

**Findings addressed.** Review finding 1.

**Files.** Modify `src/db/schema.ts`, `src/lib/files.ts`, `src/lib/normalizeSession.ts`, `src/pdf/coords.ts`, `src/pdf/flatten.ts`, and any serialization or cloning path for document metadata. Extend `tests/unit/coords.test.ts`, `tests/unit/flatten.test.ts`, `tests/unit/create-session-document.test.ts`, and `tests/unit/normalize-session.test.ts`. Create `tests/e2e/pdf-output.spec.ts`.

**Data shape.** Store serializable page geometry with viewport width and height, the scale-1 affine transform, rotation, effective view box, and UserUnit. Keep normalized placements in viewer coordinates. Treat stored geometry as derived metadata that must agree with the immutable source PDF.

- [x] Add generated fixtures for all four right-angle rotations, nonzero MediaBox and CropBox origins, differing boxes, mixed page sizes, and UserUnit values other than 1.
- [x] Verify the current exporter fails literal corner and center expectations. Include the review's 200 by 400 point rotated and cropped example.
- [x] Add a pure geometry transform that maps the placement's full rectangle and orientation into PDF user space. Derive text baselines and image basis vectors from the transform. Do not fix only the top-left point.
- [x] Update single and worker export through the same transform. Preserve source page rotation and crop boxes. Keep original PDF bytes unchanged.
- [x] Reconstruct missing geometry for legacy sessions from their source bytes before editing or export. Reject inconsistent metadata with a visible recovery path. Dispose PDFs opened only for migration.
- [x] Migrate callers together and remove obsolete page-size-only export conversions when no production caller needs them. (The size-only path remains only as the degraded fallback for sessions whose geometry cannot be reconstructed; those documents surface needs-review. See the R02 receipt.)

**Checks.** Run `npm test -- tests/unit/coords.test.ts tests/unit/flatten.test.ts tests/unit/create-session-document.test.ts tests/unit/normalize-session.test.ts` and `npm run test:e2e -- pdf-output.spec.ts`.

**Acceptance.** Validate numeric positions against independently calculated fixture coordinates. Render downloaded PDFs and compare marker bounds with preview bounds at Fit, 100%, and 150%, at DPR 1 and 2. Maximum physical placement error is 1 point. Confirm image aspect and orientation with an asymmetric PNG. Open representative outputs in a separate PDF viewer. Record export time before and after on the same fixtures.

## R03. Accept native drops and commit bounded intake

**Findings addressed.** Review findings 2 and 4.

**Files.** Modify `src/components/editor/PlacementLayer.tsx`, `src/components/DropZone.tsx`, `src/lib/files.ts`, `src/lib/workSessionEditor.ts`, `src/stores/session.ts`, and `src/lib/strings.ts`. Extend their unit tests and `tests/e2e/sign-flow.spec.ts`. Create `tests/e2e/intake-limits.spec.ts`.

**Data shape.** Use one resource-budget value with document count, page count, and source-byte count. Return a typed intake result containing accepted documents and per-file rejection reasons. Commit against the current session identity and current budget.

- [x] Reproduce a native mouse drag with Playwright `dragTo` or mouse movement. Assert one persisted placement and a visible preview. Keep synthetic tests for malformed payloads only.
- [x] Check the supported MIME type through `dataTransfer.types` during `dragover`. Read the payload only during `drop`. Validate IDs and positive dimensions before placement.
- [x] Handle every non-null file validation result, including document and page ceilings. Add an exhaustive error mapping so new variants cannot be ignored.
- [x] Serialize intake within the drop component or explicitly cancel a superseded run. Recheck the current resource budget at the store boundary before committing accepted documents.
- [x] Reject a result prepared for a different session or a session now under a batch mutation lease. Report rejected documents rather than silently losing the intake result.
- [x] Preserve per-file reporting for valid files mixed with unsupported, encrypted, corrupt, or oversized files. Keep MIME validation behavior explicit and covered by browser fixtures.

**Checks.** Run `npm test -- tests/unit/files.test.ts tests/unit/dropzone.test.tsx tests/unit/placement-layer.test.tsx tests/unit/store.test.ts tests/unit/work-session-editor.test.ts` and `npm run test:e2e -- sign-flow.spec.ts intake-limits.spec.ts`.

**Acceptance.** The 51st one-page PDF is rejected. Files at and beyond every page and byte boundary produce the expected result. Two overlapping intake operations cannot exceed the combined ceiling. Native dragging works with zoom and page scroll. File drops do not navigate the browser away from the app. Record intake time for 50 small files and reject oversized candidates before PDF parsing.

## R04. Initialize autosave and report the latest revision

**Findings addressed.** Review finding 7 and pending-edit protection.

**Files.** Modify `src/lib/sessionLifecycle.ts`, `src/lib/useSessionLifecycle.ts`, `src/App.tsx`, and `src/lib/strings.ts`. Extend `tests/unit/session-lifecycle.test.ts`, `tests/unit/use-session-lifecycle.test.tsx`, and `tests/unit/app-history.test.tsx`. Create `tests/e2e/durability.spec.ts`.

**Data shape.** Represent durability as initializing, saved, dirty, saving, memory-only, error, or conflict. Track the observed content revision separately from the revision confirmed durable. Keep the session candidate independent of save status.

- [x] Add a delayed-startup regression through the actual React hook. Load or edit before startup resolves, then resolve startup without another edit. Assert that the latest nonempty session saves.
- [x] Observe the latest revision when readiness changes. Preserve StrictMode startup and cleanup behavior without restoring disposed listeners or stale generations.
- [x] Treat pruning failure as cleanup failure rather than an autosave initialization failure. Catch discovery and preference failures. Expose storage-unavailable and storage-upgrade-blocked states accurately.
- [x] Keep Save status dirty until the latest revision's transaction completes. A prior save completion must not mark a newer edit saved.
- [x] Add `flushLatest` behavior for visibility changes and explicit close-session actions. Register `beforeunload` only while work is undurable. Do not claim that asynchronous unload saves are guaranteed.
- [x] Keep source buffers structurally shared while the debounce is pending. Do not copy every source PDF on pointer movement or status updates.

**Checks.** Run `npm test -- tests/unit/session-lifecycle.test.ts tests/unit/use-session-lifecycle.test.tsx tests/unit/app-history.test.tsx` and `npm run test:e2e -- durability.spec.ts`.

**Acceptance.** Delayed initialization no longer drops the latest revision. Injected operation errors produce visible status. A reload after Saved restores identical placements. Pending edits trigger leave protection where the browser supports it. Quota fallback keeps signing usable and never displays Saved for memory-only data. Compare input latency and copied bytes against the prior batch fixture.

## R05. Guard persisted writes and history deletion

**Findings addressed.** Review finding 3, indexed history reads, and cross-tab retention.

**Files.** Modify `src/db/schema.ts`, `src/db/history.ts`, `src/lib/sessionLifecycle.ts`, `src/lib/useSessionLifecycle.ts`, `src/lib/normalizeSession.ts`, and the store's ownership adapter. Create `src/lib/sessionOwnership.ts` if ownership needs a separate module. Extend history, lifecycle, normalization, and architecture tests. Create `tests/e2e/multi-tab.spec.ts` and `docs/adr/0002-session-persistence-ownership.md`.

**Data shape.** Keep the persisted storage revision separate from Zustand `contentRevision` and `ownershipRevision`. Read a session with its base storage revision. Create only when the ID is absent. Update or delete only when the expected revision matches an existing record. Return persisted, memory-only, conflict, or unavailable outcomes explicitly.

Keep these operations behind the history repository: `load(id)` returns the session and storage revision; `commit(snapshot, expectedRevision)` returns saved with the new revision, conflict, or memory-only; `deleteIfUnchanged(id, expectedRevision)` returns deleted, changed, or missing. The lifecycle owns revision tokens and edit authority. React consumers observe status rather than coordinating transactions.

- [x] Add two-writer tests with literal A and B placements. Assert that the second stale save is refused and the first saved content remains intact.
- [x] Read, compare, and write the revision within one IndexedDB readwrite transaction. A check before a separate `put` is not sufficient.
- [x] Distinguish a new-session create from an update to legacy revision 0. Reject an update when its record was deleted, even if its expected revision is 0.
- [x] Retain lightweight revision metadata and deletion tombstones. Prototype revision-checked saves with the existing record shape at the supported byte ceiling before choosing a payload migration. If full-record writes fail latency, quota, or memory gates, split immutable PDF and image payloads from mutable placement metadata and write new payloads and the revision-checked manifest atomically, or lower the published source-byte ceiling. Record the measured decision in the ADR; avoid an unconditional storage rewrite.
- [x] Prefer a single editor per session through Web Locks where available. Use nonblocking acquisition and a visible read-only state for the second tab. Use transactional revision checks as the correctness guarantee in every browser.
- [x] If Web Locks are unavailable, use revision-guarded editing with an explicit conflict state. Preserve unsaved local content. Offer a fresh session ID for an independent copy without replacing the newer original.
- [x] Preserve the predecessor when starting fresh; retire eager predecessor deletion and its localStorage marker. Guard explicit deletion and retention pruning against active owners and changed revisions. Acquire the same session lock before pruning; when locks are unavailable or contended, skip automatic deletion. Cancel queued stale writes when ownership changes. Revision checks alone cannot detect another tab's unsaved work.
- [x] Advance the lifecycle's base storage revision after every successful transaction, even when a newer content revision remains dirty. Save the queued newer snapshot against that returned token; do not create a conflict with the tab's own earlier save.
- [x] Integrate R04 status with the repository only after guarded operations exist. Test a pending successful save followed by another edit: the newer content stays dirty, uses the returned storage token, and then saves without a self-conflict.
- [x] If edit authority cannot be established because Web Locks are unavailable, refuse destructive history clearing and explicit session deletion. Explain the unavailable action in the UI; allow nondestructive recovery export. Optimistic editing does not authorize deleting work in other tabs.
- [x] Read only the newest complete session with a descending `by-updated-at` cursor. Prune by indexed keys. Keep memory-fallback selection behavior covered.
- [x] Add schema-version lifecycle handling for blocked upgrades, `versionchange`, and terminated connections. Do not misclassify an outdated bundle as private-browsing storage failure.
- [x] Ship a compatibility release at the current database version with a version-change close handler, then introduce a bumped version with the new stores. Block editing while old tabs prevent upgrade. Create stores during upgrade and migrate selected sessions lazily in atomic transactions; preserve legacy records on quota or interruption. Require old writing connections to close before new revision semantics become active. Never allow the legacy blind writer to share the upgraded store.
- [x] Preserve the base storage revision through normalization. Do not use `updatedAt` as a concurrency token. Avoid refreshing timestamps merely by discovering a candidate.
- [x] Record the ownership decision and the supported rollback behavior in the ADR. An old bundle that cannot read the new schema must stop and request refresh, not overwrite data.
- [x] Handle `VersionError` as an incompatible database requiring refresh. Never silently start a memory-only writer after a version mismatch. Record the minimum compatible database version in every artifact receipt.

**Checks.** Run `npm test -- tests/unit/history.test.ts tests/unit/history-open-fallback.test.ts tests/unit/session-lifecycle.test.ts tests/unit/normalize-session.test.ts tests/unit/architecture-boundary.test.ts` and `npm run test:e2e -- multi-tab.spec.ts durability.spec.ts`.

**Acceptance.** Exercise two tabs, both save orders, deleted records, owner closure, tab suspension, duplicate tabs, quota failure, and Web Locks disabled. Test a legacy open tab during upgrade. Latest work never disappears silently. A fork preserves both versions when storage permits and warns clearly otherwise. Startup reads one candidate record rather than cloning all stored PDF bytes. Record read/write latency with several retained large sessions.

## R06. Validate images and make library backups reliable

**Findings addressed.** Review findings 8 and 9, font readiness, and backup reminders.

**Files.** Modify `src/db/signatures.ts`, `src/db/schema.ts`, `src/components/library/ImportExport.tsx`, `src/components/library/LibraryTray.tsx`, `src/components/library/TypePad.tsx`, `src/components/library/canvas.ts`, and `src/lib/strings.ts`. Create a small image-validation module if both import and upload need the same policy. Extend `tests/unit/signatures.test.ts`. Create `tests/e2e/library-backup.spec.ts`.

**Data shape.** Parse a versioned envelope into validated signature assets before writing. Store a backup watermark independently from mutable labels and timestamps. Use a validated image with decoded bytes and intrinsic dimensions.

- [x] Reproduce backup failure with a valid PNG above 250 KB. Replace the spread encoder with bounded base64 conversion.
- [x] Bound JSON bytes and asset count before expensive parsing and decoding. Define and document initial import limits of 64 MiB JSON, 1,000 assets, and 64 MiB decoded image bytes. Verify these limits against the intended library fixture before adopting them.
- [x] Apply the existing 10 MiB image-file limit to individual imported PNGs too. Require nonempty IDs, supported enums, finite timestamps, valid base64, positive dimensions, and decoded PNG content matching metadata.
- [x] Cap processing dimensions at 4,096 pixels per edge and 16 million pixels before canvas allocation. Reject dimensions beyond that boundary. Normalize valid uploaded signatures to a bounded resolution without changing aspect ratio.
- [x] Decode and validate every incoming asset before opening the write transaction. Reject conflicting duplicate IDs inside one file. Count identical duplicates and existing IDs consistently. Verify failed import leaves all previous records unchanged.
- [x] Retain valid imported PNG bytes exactly. Re-encode external PNG and JPEG uploads through the existing canvas path. Release object URLs and decoded resources on success, cancellation, and failure.
- [x] Move backup timestamp and watermark acknowledgement out of envelope creation. Update them after the browser accepts the download offer. Label the status as an export offer, not proof that the user retained the file.
- [x] Implement the specified reminder after 30 days or 10 newly added assets. Use fake time and additions since the successful export watermark. Preserve legacy preference defaults.
- [x] Await `document.fonts.load` and verify the selected bundled font before generating preview or save PNGs. Surface a retryable font-loading failure instead of saving fallback typography.

**Checks.** Run `npm test -- tests/unit/signatures.test.ts` and `npm run test:e2e -- library-backup.spec.ts`.

**Acceptance.** Export, clear site storage, import, and compare signature bytes. Exercise a realistic multi-megabyte PNG, invalid image bytes, truncated base64, zero dimensions, extreme dimensions, duplicate IDs, and quota failure. Verify font consistency under delayed font loading. Capture peak decoded memory and backup time for the limit fixture. Change limits only with documented evidence.

## R07. Own PDF loading, rendering, and thumbnail resources

**Findings addressed.** Review finding 12.

**Files.** Modify `src/lib/files.ts`, `src/pdf/render.ts`, `src/pdf/runtime.ts`, `src/components/editor/EditorView.tsx`, `src/components/editor/PageCanvas.tsx`, and `src/components/editor/PageThumbnails.tsx`. Extend intake and thumbnail tests. Create `tests/unit/render-lifecycle.test.ts` and `tests/e2e/render-lifecycle.spec.ts`. Update `docs/pdf-resource-profile.md` with new measurements.

**Data shape.** Give each PDF load and canvas render an explicit owner and cancellation handle. Scope thumbnail resources to the selected document, with a bounded cache and reference-safe bitmap release.

- [x] Destroy metadata-only PDFs in `finally`, including page-limit rejection and parse failures. Retain and destroy a loading task when cancellation happens before its proxy resolves.
- [x] Dispose an editor PDF that resolves after the effect was cancelled. Keep the shared runtime worker, if introduced by R09, outside individual document ownership.
- [x] Return or expose active RenderTask cancellation. Await cancellation settlement before a new render reuses the canvas. Handle expected cancellation separately from real rendering errors.
- [x] Remove stale-completion canvas clearing. Let only the current render owner change its loading and error state.
- [x] Remove the unbounded global thumbnail cache or replace it with document-scoped retention. Close unused ImageBitmaps only after their consumers release them. Remove rejected promises so Retry can work.
- [x] Schedule thumbnail work with a small concurrency limit, initially two. Prioritize visible and nearby pages. Release resources on document change and editor unmount.

**Checks.** Run the new targeted render-lifecycle tests, existing intake and thumbnail tests, and `npm run test:e2e -- render-lifecycle.spec.ts batch-performance.spec.ts`.

**Acceptance.** Rapid zoom, scrolling, and document changes produce no blank latest canvas or unhandled page error. Cancelled loads and render tasks settle. Repeated intake, removal, and switching plateau in retained memory. Reuse the original profile fixture and its 1.5 MiB post-unmount retained-heap allowance. Measure ArrayBuffers, worker resources, and process memory as well as JavaScript heap. Keep synthetic and real-document results separate.

## R08. Use one text layout for preview and export

**Findings addressed.** Review findings 10 and 11.

**Files.** Modify `src/pdf/flatten.ts`, `src/components/editor/PlacedElement.tsx`, `src/pdf/coords.ts`, `src/lib/strings.ts`, `src/lib/batchSigning.ts`, and `src/workers/flatten.worker.ts` where font bytes cross the worker boundary. Create `src/pdf/textLayout.ts`, a bundled font manifest, and font license files. Extend flatten tests. Create `tests/e2e/text-output.spec.ts`.

**Data shape.** Represent resolved text as lines, page-unit baselines, glyph-supported font runs, padding, size, and bounds. Share resolved date text and its effective date across preview and the export attempt.

- [x] Add ASCII, accented Latin, Greek, Cyrillic, Chinese, multiline, long-word, and unsupported-glyph fixtures. Specify expected text and bounds independently of implementation.
- [x] Prototype one bundled Unicode family with fontkit for Latin, Greek, and Cyrillic. Treat CJK as a separate coverage and asset-budget decision; prototype a fallback if it enters the declared release scope. Verify shaping, export extraction, output size, worker use, and license coverage before selecting assets. The Chinese fixture must either export correctly or produce the explicit unsupported-script result.
- [x] Declare the supported script set. Do not advertise universal Unicode or emoji support. Display an unsupported-character message before export for characters outside available coverage.
- [x] Embed subsetted fonts for supported text. Preserve meaningful errors rather than blaming a valid source PDF. Cache immutable font bytes, not PDF-document-specific embedded font objects.
- [x] Apply the same font metrics, padding, wrapping, clipping or overflow policy, and line breaks in preview and export. Scale preview font size by zoom and UserUnit as required by R02.
- [x] Preserve input whitespace intentionally. Resolve dates consistently for the export attempt so a midnight crossing cannot change the output between documents without notice.
- [x] Align signature image fitting too. The preview's contained image and exported image must share the same aspect-preserving inner rectangle.

**Checks.** Run `npm test -- tests/unit/flatten.test.ts` plus new text-layout unit tests, then `npm run test:e2e -- text-output.spec.ts pdf-output.spec.ts batch-flow.spec.ts`.

**Acceptance.** Preview and downloaded text match at each zoom level and rotation. Supported text remains selectable and extracts correctly from the PDF. Unsupported glyphs produce a specific pre-export error. Long text cannot unexpectedly cover an adjacent field. Record added preload bytes, font embedding time, and output size for a ten-document batch.

## R09. Finish loading before declaring offline readiness

**Findings addressed.** The reproduced offline failure and incomplete privacy verification.

**Files.** Modify `src/main.tsx`, `src/App.tsx`, `src/pdf/runtime.ts`, `src/pdf/render.ts`, `src/stores/session.ts`, `src/workers/flatten.worker.ts`, `src/components/editor/EditorView.tsx`, `src/components/batch/ApplyToAll.tsx`, `src/lib/strings.ts`, `vite.config.ts`, `tests/e2e/zero-network.spec.ts`, `tests/e2e/sign-flow.spec.ts`, and `tests/e2e/batch-flow.spec.ts`. Create a runtime-readiness module, generated asset manifest, and `tests/e2e/offline-flow.spec.ts`.

**Data shape.** Use loading, ready, and failed runtime states. Ready owns loaded modules, script fonts, PDF data assets, and started worker capacity. Provide Retry after a failed preflight.

- [ ] Prototype first-use signing under the unchanged `connect-src 'none'` policy. Capture every HTTP request from navigation, then mark the readiness boundary explicitly.
- [ ] Load the editor, flattening modules, script fonts, export fonts, and data assets before enabling intake. Make the readiness state visible and accessible.
- [ ] Bundle CMaps and standard font bytes into generated JavaScript modules loaded through the existing script policy, then retain them in an in-memory lookup. `connect-src 'none'` also blocks preflight fetches; do not assume earlier fetch timing makes them permitted. Use PDF.js custom `CMapReaderFactory` and `StandardFontDataFactory` with `useWorkerFetch=false`. Verify the installed PDF.js API signatures during implementation. Do not allow same-origin fetch just to make auxiliary assets work.
- [ ] Start PDF and flatten workers before readiness. Reuse them or use preloaded in-memory sources in a way that produces no later HTTP request. Keep shared worker ownership distinct from document disposal. Recreate capacity only from already-loaded bytes after a worker crash.
- [ ] Require ready handshakes from both workers. Test document destruction followed by another document, and batch cancellation followed by a new batch, without stale messages or HTTP requests.
- [ ] Move per-attempt flatten-worker creation behind the runtime owner. Identify jobs and cancellation explicitly so late messages cannot complete a newer batch. Preserve reusable capacity or recreate a self-contained worker from resident bytes after cancellation; do not destroy the shared PDF worker when closing one document.
- [ ] Withdraw readiness and pause intake after a worker crash until resident-byte recovery completes. Surface a retryable failure if capacity cannot be restored.
- [ ] Test a PDF that actually requires a CMap and a nonembedded standard font. A simple generated Helvetica PDF is insufficient evidence.
- [ ] Start request capture before the first drop. Remove blanket bundled-asset and worker exclusions after readiness. Observe dedicated worker requests through browser-context instrumentation as well as page events.
- [ ] Set a fresh browser context offline immediately after Ready. Exercise draw, type, upload, library import, intake, reload-safe editing within the same loaded tab, single export, batch export, and retry paths.
- [ ] Keep offline reload support separate. A service worker is optional work O03. Do not claim an offline new-tab launch is supported by this task.
- [ ] Measure shell-interactive and offline-ready timings separately. Keep the original cold-ready target of 2.5 seconds and warm target of 1 second as acceptance goals on recorded target hardware. Do not silently redefine the initial 300 KiB budget to hide additional startup bytes.

**Checks.** Run `npm run build`, `npm run verify:production`, and `npm run test:e2e -- zero-network.spec.ts offline-flow.spec.ts sign-flow.spec.ts batch-flow.spec.ts`.

**Acceptance.** First use after readiness succeeds offline. Zero HTTP requests occur after the boundary across the full signing flow. No CSP violations remain unexplained. Record total bootstrap transfer size in addition to entry-chunk size. If font or asset preflight misses readiness budgets, optimize or record an explicit product-budget decision before declaring this task complete.

## R10. Complete keyboard access and local-data controls

**Findings addressed.** Review finding 13, narrow screens, visible focus, retention copy, and explicit local-data management.

**Files.** Modify `src/components/ui/Modal.tsx`, `src/components/editor/EditorView.tsx`, `src/App.tsx`, `src/index.css`, `src/lib/strings.ts`, and the storage and lifecycle facades for guarded data clearing. Create local-data controls under `src/components/`. Extend modal and app tests. Create `tests/e2e/accessibility.spec.ts` and `tests/e2e/local-data.spec.ts`.

- [ ] Traverse only enabled visible dialog controls. Recompute targets when dialog content changes. Restore focus to the initiating control or a valid fallback when closing.
- [ ] Exercise both Tab directions with disabled Save, changing controls, Escape, and nested dialog behavior. Keep editor shortcuts inactive while a dialog owns the keyboard.
- [ ] Use visible focus tokens and verify contrast against the actual backgrounds. Complete a screen-reader smoke of placement announcements and save warnings.
- [ ] Collapse the fixed sidebars behind keyboard-accessible controls on narrow screens. Verify 360, 768, and 1,280 CSS-pixel viewports and 200% browser zoom. Preserve desktop batch operation.
- [ ] Add separate actions for clearing document history and clearing all local data. Show the retention period and which signatures, PDFs, preferences, and placements each action affects.
- [ ] Before clearing, offer library export and show an explicit confirmation. Stop saves and workers, obtain the necessary ownership guards, and clear persistent and memory stores together. Refuse deletion while another tab owns affected data.
- [ ] Verify a cancelled confirmation changes nothing. Verify completed clearing cannot be undone by a queued autosave or a second tab.

**Checks.** Run `npm test -- tests/unit/modal.test.tsx tests/unit/app-history.test.tsx tests/unit/editor-shortcut-scope.test.tsx` and `npm run test:e2e -- accessibility.spec.ts local-data.spec.ts`.

**Acceptance.** A user can load, place, edit, and download using only the keyboard. Focus never sticks on disabled Save. Controls remain usable on narrow screens. Clear history retains signatures. Clear all removes both persistent and in-memory data. Save and ownership status stays accurate throughout.

## R11. Publish the tested artifact through Cloudflare Pages

**Findings addressed.** Review findings 5, 6, and 14. Cloudflare Pages is the confirmed target.

**Files.** Modify `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `vite.config.ts`, `index.html`, `src/index.css`, runtime asset paths, `scripts/verify-production.mjs`, and `docs/launch-notes.md`. Create `public/_headers`, host-verification tests, and a pinned Wrangler development dependency when required for direct upload.

- [ ] Use root hosting on Cloudflare Pages. Normalize remaining runtime asset references through the configured base URL. Verify a temporary subpath build too so assets do not rely on accidental root paths.
- [ ] Replace the GitHub Pages publisher with Cloudflare Pages direct upload of the verified artifact. Remove GitHub Pages-specific permissions and competing publish triggers.
- [ ] Reuse the verified CI output without rebuilding in deployment. Bind the artifact to the tested commit and hash receipt. Upload only after all required jobs for that commit pass.
- [ ] Keep deployment credentials in GitHub secrets or the deployment environment. Restrict publishing to trusted release events. Pull requests, especially forks, must not receive production credentials.
- [ ] Check whether a Cloudflare Pages project already exists and whether it uses Git integration. Disable competing automatic production builds before enabling the CI-managed upload path. Avoid creating a second production origin that splits browser-local storage.
- [ ] Serve CSP through `public/_headers`. Preserve `connect-src 'none'`, `object-src 'none'`, and `frame-ancestors 'none'`. Add `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Keep the meta policy compatible with the header.
- [ ] Revalidate HTML across releases. Cache only genuinely fingerprinted assets as immutable. Ensure fonts and data assets also have a deliberate versioning policy.
- [ ] Test effective HTTP response headers and browser-enforced framing, including the worker policy. A string in HTML is insufficient evidence.
- [ ] Disable host features that inject analytics, third-party scripts, or runtime beacons. Verify the deployed page source and request capture.
- [ ] Document project ID, canonical origin, build receipt, deploy receipt, and rollback procedure. Rollback must account for the storage schema compatibility established in R05.

**Checks.** Run the local production checks, the host-header browser fixture, and the supported browser matrix. Verify headers and real single and batch signing on an authorized Cloudflare Pages preview deployment. Configure the production path with a release gate; leave promotion to R13.

**Acceptance.** The deployed artifact matches the verified hash manifest. A failed check cannot publish. An external iframe cannot embed the app. Live signing produces no post-readiness requests. All assets and workers have correct MIME types. No credentials appear in `dist/`. Record the actual production URL and browser results rather than marking deployment complete from a workflow skeleton.

## R12. Update affected dependencies and include license notices

**Findings addressed.** Development dependency audit and missing distribution notices.

**Files.** Modify `package.json`, `package-lock.json`, build and test configuration only where an upgrade requires it, and `README.md`. Create `LICENSE`, `THIRD_PARTY_NOTICES.md`, and the applicable font notices under `public/fonts/`.

- [ ] Rerun `npm audit --json` and `npm audit --omit=dev --json`. Preserve the dated reports. Identify reachable development-tool risks separately from shipped runtime risks.
- [ ] Apply compatible updates first. Handle Vitest or Tailwind major upgrades in separate changes if required. Do not apply forced downgrade suggestions without reviewing their effect on the build.
- [ ] Pin the chosen toolchain through the lockfile and verify a clean install. Run all checks after each independent upgrade group.
- [ ] Preserve the runtime privacy architecture. Do not add telemetry as part of dependency replacement.
- [ ] Identify the original licenses for the exact bundled fonts, CMaps, standard fonts, and new export fonts. Include required notices in the distributed artifact.
- [ ] Ask the project owner to choose the project license before creating its final legal text. File and font notice work can proceed independently of that choice. Do not invent a license grant.
- [ ] Resolve high-risk reachable findings or record a bounded, evidence-backed disposition with a follow-up date. Distinguish advisory presence from an exploit in this static product.

**Checks.** Run `npm ci`, both audit commands, all repository checks, and the browser matrix against the rebuilt artifact.

**Acceptance.** No newly introduced runtime advisory or unexplained high-risk development finding remains. Distribution includes the notices for all shipped assets. Record changed startup bytes and processing times. R13 uses this updated artifact, not a previously tested dependency tree.

## R13. Qualify the release candidate and update acceptance records

**Findings addressed.** Missing real-document, browser, performance, storage-recovery, and production acceptance evidence.

**Files.** Modify `playwright.config.ts`, `.github/workflows/ci.yml`, `docs/product-roadmap.md`, `README.md`, `docs/batch-performance.md`, `docs/pdf-resource-profile.md`, `docs/daily-driver-log.md`, `docs/launch-notes.md`, and the review's disposition table. Create `docs/release-acceptance.md`.

- [ ] Add Chromium, Firefox, and WebKit projects with stable names. Install all three in CI. Keep the full functional matrix separate from a controlled Chromium performance job.
- [ ] Run typecheck, lint, unit tests, build, production verification, and functional browser checks from a clean checkout. Preserve the artifact hash and test receipts.
- [ ] Include the new native-drag, geometry, Unicode, two-tab, delayed-startup, backup, quota, rendering, keyboard, headers, and offline scenarios in required release checks.
- [ ] Run the founder's representative document gauntlet. Keep sensitive files and screenshots local. Record sanitized fixture descriptions and pass results in documentation.
- [ ] Perform the complete library wipe-and-restore drill in a real browser. Verify byte-identical images and the persistence request outcome without claiming that browsers guarantee permanent retention.
- [ ] Measure cold and warm readiness, first-page rendering, editing long tasks, batch processing, and retained memory on named target hardware. Run baseline and candidate measurements interleaved with the same files.
- [ ] Meet the PRD goals of first render below 2 seconds for representative PDFs under 10 MB, 10 documents by 5 pages below 15 seconds, and no editing main-thread task above 50 ms on the recorded target fixture. Retain the existing 20-document performance fixture as additional coverage.
- [ ] Distinguish 500 MiB of source data from total process memory. If supported browsers cannot safely handle the published ceilings, lower the product limits explicitly and update copy, docs, and tests together.
- [ ] Once all prepublication checks pass, promote the exact qualified artifact through R11's production path under the owner's deployment authorization. Do not rebuild, substitute a prior artifact, or expose production credentials to preview jobs.
- [ ] Complete public-origin headers, offline signing, single output, and batch ZIP verification. Record the canonical URL, deployment ID, browser versions, and date.
- [ ] Reconcile README and roadmap counts from actual completed checkboxes. Update each review finding with its task, evidence path, and verified disposition.
- [ ] Start the 30-day daily-driver log with actual usage records. Keep the pilot milestone separate from technical qualification. Do not fabricate elapsed acceptance time.

**Acceptance.** Every required release condition has evidence. No reproduced signing or durability blocker remains open. Record VERIFIED, NOT VERIFIED, or INCONCLUSIVE for each gate. Treat an inconclusive result as unfinished work. A technically qualified pilot may begin while the 30-day observation runs. Report the observation's real status separately from the public-release decision.

## Close the release work

- [ ] Verify every R01 through R13 task receipt against the exact release commit.
- [ ] Verify the deployed artifact and rollback compatibility one final time after the dependency and schema changes settle.
- [ ] Keep the original review evidence and link each finding to its disposition. Do not replace the review with a claim that tests alone establish readiness.
- [ ] Deliver the release acceptance record with remaining product decisions and daily-driver status.

## Appendix A. Trace every review item

| Review item | Required task | Evidence |
| --- | --- | --- |
| 1. Rotated and cropped output | R02 | Literal coordinates and exported-PDF comparison |
| 2. Native drag acceptance | R03 | Real mouse drag with persisted placement |
| 3. Cross-tab overwrite | R05 | Two-tab write, delete, and ownership fixtures |
| 4. Resource ceiling | R03 | Boundary and concurrent-intake tests |
| 5. Deployment bypass | R01, R11 | Failed-gate publish refusal and artifact hashes |
| 6. Root-only asset paths | R11 | Root and subpath builds |
| 7. Startup autosave | R04 | Delayed hook and browser restore |
| 8. Backup stack overflow | R06 | Large valid PNG round-trip |
| 9. Import validation | R06 | Atomic invalid-import rejection |
| 10. Unicode export | R08 | Supported-script output and unsupported-glyph error |
| 11. Preview/export mismatch | R02, R08 | Shared layout and rendered output |
| 12. Resource disposal | R07 | Cancellation and retained-memory measurements |
| 13. Dialog keyboard traversal | R10 | Forward and reverse Tab, restored focus |
| 14. Framing protection | R11 | Effective headers and blocked iframe |
| Offline failure and privacy-test gaps | R09 | Fresh-context first-use offline flow |
| Backup reminders and font loading | R06 | Fake-time reminder and delayed-font save |
| Save status and leave protection | R04, R05 | Dirty/latest revision status and conflict handling |
| Indexed history reads and retention | R05, R10 | Cursor reads and owner-safe cleanup |
| Narrow screens and visible focus | R10 | Browser viewport and keyboard receipts |
| Dependency and notice gaps | R12 | Dated audits and shipped notices |
| Real documents, hosting, and daily-driver evidence | R13 | Release acceptance record |
| Recent sessions and complete session backup | O02 | Explicitly deferred product scope |
| Saved batch presets | O01 | Explicitly deferred product scope |
| Offline reload and installability | O03 | Explicitly deferred product scope |

## Appendix B. Plan optional improvements after qualification

### O01. Save reusable batch placement templates

Depends on R02, R05, and R08. Store a versioned placement preset with referenced immutable signature snapshots and page-geometry assumptions. Include naming, delete, compatibility warnings, and a preview before replacing placements. Reuse the existing apply-to-all transaction and undo semantics. Test mixed page sizes, missing pages, deleted library assets, and edited presets. Do not mark mismatched documents ready without review.

### O02. Export complete sessions and show recent history

Depends on R05, R06, and R10. Use a bounded versioned archive containing a manifest, original PDF bytes, placements, and deduplicated signature snapshots. Validate all members, sizes, IDs, and geometry before creating a fresh session. Reject archive expansion beyond resource ceilings. Use metadata-only history queries for up to five recent sessions. Test large work, quota failure, older envelopes, and byte-identical restore. Keep archive backup distinct from library backup.

### O03. Support offline reload through a service worker

Depends on R09 and R11. Precache a versioned build atomically. Keep updates from replacing an in-progress signing runtime or changing its IndexedDB expectations. Verify an offline new-tab launch, failed update, old/new tabs, cache cleanup, canonical-origin behavior, and unchanged post-readiness request policy. Add installability only if the owner wants it. Do not use this work as a substitute for R09.

## Appendix C. Record design choices and implementation gates

| Choice | Planned approach | Gate before completion |
| --- | --- | --- |
| Delivery model | Small ordered changes with per-task receipts | Independent PDF and storage review |
| Production host | Cloudflare Pages, confirmed by the user | Existing project mode and canonical origin checked |
| Publishing | Direct upload of the verified artifact | CI failure cannot publish and hashes match |
| Concurrency | Transactional revision checks with Web Locks when available | Old bundle coexistence and lock-disabled tests |
| Storage payloads | Keep existing records if measurements pass; otherwise split immutable payloads or reduce limits | Large-session autosave cost, deletion, and interrupted migration |
| Page geometry | Source-derived affine transform in viewer coordinates | Rotation, crop, MediaBox, UserUnit fixtures |
| Text | Shared page-unit layout with declared font coverage | Font/shaping/output prototype and measured cost |
| Privacy | Zero HTTP requests after explicit offline readiness | Fresh-context worker and auxiliary-asset capture |
| Recovery | Conflict refusal and independently saved copies | Quota and owner-disappearance fixtures |
| Library limits | Bounded import and decoded image processing | Representative library measurements |
| Storage rollback | Forward-compatible writer or safe refresh refusal | Version-change and blocked-upgrade fixtures |

Two independent design proposals and an independent judge informed this plan. The final shape combines authoritative revision checks with per-session Web Locks and guarded deletion. The judge favored retaining existing records initially; the payload split is therefore a measured decision gate, not a mandatory rewrite. An origin-wide exclusive lock was considered, but per-session guards permit unrelated sessions to proceed independently. Automatic pruning remains disabled without an ownership guard. Avoid persisted heartbeat leases; they introduce timeout and takeover policy without replacing revision checks.

The review already reproduced geometry, drag, startup, backup, import, and offline failures. Preserve those fixtures as regression evidence in R01 through R09. The alternative storage and runtime shapes require implementation-time prototypes. No plan checkbox implies those experiments have already passed.

Avoid an event log or a generic command bus for the first release. The existing grouped mutation boundary is sufficient if persistence refuses stale writers. Avoid treating BroadcastChannel messages or localStorage timestamps as an exclusive lock. Avoid broad service-worker work before first-use offline signing works in the loaded tab.

The remaining owner decisions are the project license, the supported text scripts beyond the initial declared set, and whether optional work O01 through O03 enters a later milestone. The strict privacy promise stays in scope. Change readiness or resource budgets only through a recorded product decision backed by measurements.

## Appendix D. Preserve performance and rollback evidence

For each behavior change, record the same fixture and metric before and after. Use alternating baseline/candidate runs on the same machine. Record medians, slowest runs, browser versions, and whether caches were cold. Do not infer memory safety from JavaScript heap alone or compare unlike startup states.

Use existing PRD budgets as absolute acceptance limits. Investigate any same-fixture timing increase above 10 percent before integration. This threshold is a proposed regression policy, not a measurement from the review. A reproducible regression requires an explanation or correction.

Keep additive metadata migrations compatible until their verification completes. Preserve the latest durable session during Start fresh and failed migration. Never roll production back to a writer that can bypass the new revision rules. Roll back code independently from browser-local data and retain a tested refresh or recovery path.

## Appendix E. Read the implementation references

- [Production readiness review](../production-readiness-review.md).
- [Product requirements](../prd.md).
- [Signing consistency decision](../adr/0001-work-session-owns-signing-consistency.md).
- [PDF resource profile](../pdf-resource-profile.md).
- [Batch performance verification](../batch-performance.md).
- [Launch notes](../launch-notes.md).
- [Vite runtime requirements](https://vite.dev/guide/). Verify the pinned Node version against the chosen Vite release.
- [Cloudflare Pages HTTP headers](https://developers.cloudflare.com/pages/configuration/headers/). Pages applies `_headers` rules to static responses.
- [Cloudflare Pages direct upload with CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/). Use this path to upload prebuilt artifacts.
- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/). Check existing project mode and automatic publishing before changing deployment ownership.
- Installed `node_modules/pdfjs-dist/types/src/display/api.d.ts` and `node_modules/pdfjs-dist/types/src/display/display_utils.d.ts`. Confirm factory, worker, and viewport APIs against the installed version rather than a remembered release.

Sequence Work into Verifiable Units shaped the task boundaries and dependency order. Model the Domain shaped geometry, durability, and revision models. Boundary Discipline shaped import and intake validation. Prove It Works shaped output, native-browser, and deployed-artifact acceptance.
