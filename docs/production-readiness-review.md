# Production readiness review

Reviewed on October 3, 2026 against the current working tree, including pre-existing uncommitted changes. This report does not change application behavior.

SignLite is not ready for an unrestricted public release. The main product flows exist. The remaining work is primarily output correctness, durability, browser verification, and release controls. A backend, accounts, payments, and telemetry are unnecessary for the documented local-first product.

Evidence labels distinguish reproduced failures, source findings, and recommendations. Source findings describe a reachable code path but do not establish its frequency in real use.

## Release blockers

### 1. PDF placements ignore rotation and cropping

Priority P1. Reproduced with actual `flattenDocument` and a generated PDF.

`src/lib/files.ts` records PDF.js viewport dimensions. `src/pdf/flatten.ts:59` instead converts placements with `page.getSize()`, without the viewport transform, rotation, or CropBox origin.

A 200 by 400 point page with 90 degree rotation and CropBox `(10,20,180,360)` displays as 360 by 180. A placement at screen `(36,18)` maps to PDF `(28,56)`. Exported text instead starts at PDF `(20,348)`, which maps back to screen `(328,10)`. Signature images use the same incorrect rectangle conversion.

Carry the effective page geometry and invert the viewport transform during export. Transform image orientation as well as position. Verify corners and center on pages rotated 0, 90, 180, and 270 degrees, with nonzero crop origins. Compare the downloaded PDF in a separate viewer.

### 2. Native dragging reads protected data too early

Priority P1. Reproduced with native Chromium dragging against the production build.

`src/components/editor/PlacementLayer.tsx:194` calls `parseDragAsset` during `dragover`. That parser calls `getData`. Native drag payloads are protected outside `dragstart` and `drop`, so this condition does not call `preventDefault` for a normal native drag. The target therefore does not accept the drop.

The browser probe recorded the expected MIME type, an empty dragover payload, `defaultPrevented=false`, no drop event, and zero placed signatures. Check `dataTransfer.types` during `dragover`. Read and validate the payload during `drop`. The existing sign-flow test dispatches synthetic events with a readable DataTransfer, which bypasses this browser restriction. Add a real mouse drag regression.

Reference. [MDN drag data store](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_data_store).

### 3. Two editing tabs overwrite the same session

Priority P1. Reproduced through the actual history module with fake IndexedDB.

`src/db/history.ts:31` replaces the complete session with `db.put`. Two tabs can resume the same session, edit independently, and save incompatible snapshots. Saving placement A followed by placement B leaves only B. The in-memory mutation lease does not coordinate browser tabs.

For v1, prefer a single active editor per session. Coordinate ownership across tabs and verify a persisted revision in the IndexedDB write transaction. Warn on conflicts and preserve a recoverable copy. Include Start fresh and predecessor deletion in the ownership rules.

### 4. The document-count ceiling is not enforced by intake

Priority P1. Source finding.

`src/lib/files.ts:45` returns `session-limit` at 50 documents. `src/components/DropZone.tsx:48` handles only three validation results and continues parsing when this limit is returned. `src/lib/workSessionEditor.ts:238` subsequently concatenates the documents without a ceiling. A batch of 51 small one-page PDFs passes the reachable acceptance path.

Reject every non-null validation result with the appropriate copy. Validate aggregate resource budgets when committing intake so concurrent drop operations cannot use stale budgets. Add a UI-level test for the 51st document and overlapping intake.

### 5. Deployment can publish when CI fails

Priority P1. Source finding.

`.github/workflows/deploy.yml` installs dependencies, builds, and publishes. Its deployment dependency does not include the separate CI workflow. Failed lint or tests can coexist with a successful deployment of the same commit.

Make deployment depend on verification of the exact commit and artifact. Reuse a verification job or workflow, then publish its tested artifact. Require lint, typecheck, unit tests, production-budget checks, and signing browser checks before publication.

### 6. GitHub Pages assumes root hosting

Priority P1 if deploying at a repository subpath. Source finding.

`vite.config.ts` has no Pages base path. PDF resources in `src/pdf/render.ts:19`, fonts in `src/index.css`, and HTML resources use root URLs. The usual `/signlite/` Pages URL therefore requests resources from the wrong directory. A custom domain hosted at `/` avoids this particular defect.

Choose the intended hosting path. Configure Vite `base` and derive runtime resource URLs from `import.meta.env.BASE_URL`. Exercise a production build under that exact path.

Reference. [Vite static deployment](https://vite.dev/guide/static-deploy.html).

## Required hardening

### 7. Autosave misses revisions observed before startup completes

Priority P2. Reproduced with the actual React hook and a delayed lifecycle controller.

`src/lib/sessionLifecycle.ts:153` ignores revisions while readiness is false. `src/lib/useSessionLifecycle.ts:28` observes content revisions but does not rerun when readiness changes. Completing startup renders `ready=true` without observing the latest revision. Early intake or edits remain unsaved until another mutation.

Observe the current revision when initialization becomes ready. Handle startup rejection explicitly. Pruning or preference-read failures currently escape startup and can leave autosave disabled without a warning.

### 8. Large signature assets break backups

Priority P2. Reproduced through actual `exportLibrary`.

`src/db/signatures.ts:43` spreads every PNG byte into `String.fromCharCode`. A saved 250,000-byte asset produces `RangeError: Maximum call stack size exceeded`. The upload UI allows images up to 10 MB.

Encode in bounded chunks. Test export and import with realistic PNG sizes and compare the restored bytes. Update the backup timestamp after the download offer succeeds rather than before artifact creation.

### 9. Library import validates types but not image content

Priority P2. Reproduced through actual `importLibrary`.

`src/db/signatures.ts:82` accepts a record containing bytes `[1,2,3]` as PNG data, width `-4`, and height `0`. It reports a successful import and persists the unusable asset. Duplicate incoming IDs also inflate the reported additions.

Bound input file size, record count, decoded byte count, and image dimensions. Require valid PNG decoding and consistent intrinsic dimensions. Reject invalid records before opening the write transaction. Deduplicate incoming IDs.

`src/components/library/canvas.ts` also allocates canvases at full uploaded dimensions. Compressed file-size limits do not bound decoded pixel memory. Check dimensions and total pixels before allocating the processing canvas.

### 10. Unicode text prevents PDF export

Priority P2. Reproduced through actual `flattenDocument`.

`src/pdf/flatten.ts:52` embeds standard Helvetica. ASCII `Hi` exports successfully. `你好` and an emoji fail with a message blaming the valid source PDF.

Embed a bundled font covering the supported scripts, with fontkit where needed. Provide a precise unsupported-character error for characters outside that coverage. Preserve useful error causes. Typed signatures rasterized through canvas use a different path and are not the reproduced failure.

### 11. Text preview does not match exported text

Priority P2. Source finding.

`src/components/editor/PlacedElement.tsx` renders text with unscaled CSS font size, padding, clipping, and browser wrapping. `src/pdf/flatten.ts:77` draws text in PDF points without equivalent padding or width constraints. Zoom changes the relationship, and long values can exceed the preview box in the export.

Define a shared text layout in page units. Scale it for preview. Use the same padding, line breaks, and bounds in PDF output. Compare preview and exported output at multiple zoom levels.

### 12. Render and PDF lifetimes need complete cleanup

Priority P2. Source finding. Memory impact and runtime frequency were not measured in this review.

`src/lib/files.ts:52` opens PDFs for metadata without destroying them in a finally block. `src/components/editor/EditorView.tsx:144` misses cleanup when a cancelled load resolves after effect cleanup. `src/pdf/render.ts` retains thumbnail promises indefinitely without closing bitmaps or evicting failed entries.

`src/components/editor/PageCanvas.tsx:111` launches render promises without rejection handling. Cleanup cancels scheduled work but not an active PDF.js RenderTask. Older render completion can clear a canvas reused by a newer render.

Destroy intake PDFs on all paths. Dispose loads that resolve after cancellation. Return and cancel render tasks, coordinate canvas ownership, handle rendering errors, and bound thumbnail retention. Verify repeated intake, removal, document switching, and zoom against retained memory measurements.

### 13. Modal keyboard traversal includes disabled controls

Priority P2. Source finding.

`src/components/ui/Modal.tsx:25` includes disabled buttons in its captured focus list. Tab from Cancel in an empty TypePad attempts to focus disabled Save and stays on Cancel. Closing also does not restore focus to the initiating control.

Use enabled visible focus targets, handle changing dialog content, and restore focus on close. Test forward and reverse Tab with disabled Save and keyboard-only signing.

### 14. Production framing protection is ineffective

Priority P2. Source finding supported by the CSP specification.

`index.html` supplies `frame-ancestors 'none'` in a meta CSP. Browsers ignore that directive in meta elements. The production check only searches for `connect-src 'none'`, so it cannot establish effective framing protection.

Serve CSP as an HTTP header, including `frame-ancestors`. Verify response headers on the live origin. Keep the existing no-connect policy and test the deployed artifact.

Reference. [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

## Missing acceptance work and useful additions

- Complete the representative real-document signing gauntlet. Include scanned, rotated, cropped, form-filled, multilingual, large, encrypted, and damaged PDFs. Verify outputs in an independent viewer.
- Complete the browser-storage wipe and restore drill with byte-identical signatures. Run quota recovery and two-tab tests.
- Record performance on target hardware with representative PDFs. Synthetic generated text PDFs do not establish safety at the 500 MB source-byte ceiling.
- Record a live production URL and complete the signing and network verification log. The launch notes still list pending URLs.
- Add Firefox and WebKit coverage. The current configuration and CI exercise Chromium only.
- Implement the specified backup reminder after 30 days or 10 new assets. The current UI displays only the last-export timestamp.
- Display saved, saving, dirty, and memory-only states. Protect pending edits when users leave or reload. A 500 ms debounce creates a loss window, and asynchronous unload work is not a reliable guarantee.
- Retrieve only the newest session with a descending IndexedDB index cursor. `loadLatestSession` currently loads every complete session, including all source PDF bytes, to select one. Prune by indexed keys rather than full records.
- Add explicit clear-local-data controls and explain the seven-day history retention policy. Make document retention understandable to users of a privacy-focused tool.
- Add session export and import if restoring complete work across browsers matters. Signature-library backup currently excludes PDFs and placements.
- Implement up to five recent sessions if the P2 FR-017 requirement remains in scope. It is not a launch blocker for a single-session personal tool.
- Add saved batch placement presets after correctness work. They improve the repeated batch workflow without changing the local-first architecture.
- Make narrow screens usable by collapsing sidebars. The fixed 280 px and 320 px columns leave no practical editing area on small viewports. Touch-first signing can remain deferred.
- Await bundled font readiness before rasterizing typed signatures. Font preloads reduce the race but do not guarantee that the intended font is ready.
- Add the project license and bundled font notices before public distribution. Confirm license terms against the actual assets.
- Reconcile README and roadmap status. README says 33 of 41, the roadmap header says 35, and five unchecked task entries imply 36 complete. Completion should reflect verification evidence.

## Privacy and offline verification

The app contains no backend, accounts, or telemetry in the reviewed source. Preserve that product decision.

The strict zero-request promise is not established by the current tests. The single signing test starts observing after PDF intake and a delay. It therefore misses lazy editor, parser, and font loading during intake. The shell test permits bundled asset requests after load. The batch test likewise starts observing after intake and exempts workers.

A production Chromium probe loaded the drop screen in a fresh browser context, switched the context offline, and dropped a valid generated PDF. Intake rejected it as damaged. The lazy PDF runtime was unavailable. This is a reproduced violation of the PRD's claim that the complete pipeline works offline once the app is loaded.

Define whether the promise means no document uploads or literally no HTTP requests after the app is ready. If literal silence and offline use from that moment are required, finish warming all signing dependencies before showing readiness and test from before the first drop. Set the browser offline immediately after readiness, then exercise first-time signature creation, PDF intake, editing, and both download paths. Test a fresh profile rather than relying on warmed caches. A service worker is an option for offline reload support, which is separate from keeping an already-loaded tab functional.

Reference. [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Dependency review

The live npm audit reported 14 affected package entries, with 11 high and 3 moderate findings. All belong to the development dependency tree. The runtime-only audit returned zero advisories. These are advisory counts, not evidence of exploitability in the shipped static app.

Affected direct development packages include PostCSS, Tailwind CSS, vite-plugin-static-copy, and Vitest. Review the advisories and update compatible dependencies first. Assess major upgrades separately and rerun the artifact checks. Do not blindly accept `npm audit fix --force`, whose suggested changes include major upgrades and a static-copy downgrade.

The full audit output is preserved locally at `/tmp/signlite-audit.json`. Advisory information changes over time, so rerun the audit before release.

## Recommended implementation order

The detailed tasks, dependencies, acceptance checks, and Cloudflare Pages delivery plan are tracked in [the production readiness implementation plan](plans/2026-10-03-production-readiness-implementation.md). The plan is not evidence that the findings are fixed.

1. Repair lint and gate deployment on the verified artifact. Fix the intended hosting base and HTTP security headers.
2. Fix native drag acceptance and PDF geometry. Add output-level regression fixtures before further editor work.
3. Fix autosave startup and multi-tab ownership. Add visible durability status and pending-edit protection.
4. Repair backup encoding and import validation. Add decoded-image limits and complete the wipe-and-restore drill.
5. Align text preview and export, support intended scripts, and finish PDF/render disposal.
6. Complete browser, accessibility, offline, real-document, and live-host acceptance checks.
7. Add saved templates, session export, and recent history according to demonstrated workflow needs.

Accounts, cloud sync, audit trails, cryptographic signing, and DOCX conversion are separate products or requirements. They should not delay a reliable local PDF signing release.

## Verification results

- `npm run typecheck` passed.
- `npm run lint` failed. `scripts/verify-production.mjs:28` uses `console` without Node globals in its ESLint configuration. Add a scoped Node configuration for scripts and rerun lint. This currently fails the CI gate.
- `npm run build` passed.
- `npm run verify:production` passed against the rebuilt artifact. Initial application chunks total 63,461 gzip bytes, approximately 62 KiB, below the 300 KiB budget. This check does not prove all loaded assets are present or that response headers are effective.
- `npm run test:e2e` passed all four tests against the production preview after allowing the local server to bind outside the sandbox. The initial sandbox run timed out during startup. These passing tests do not cover the reproduced native-drag and cold offline failures.
- The initial `npm test` run passed 187 of 188 tests. One editor shortcut test timed out. All four tests in that file passed when rerun alone. The complete suite passed all 188 tests across 30 files with `npm test -- --maxWorkers=2`. The original timeout is therefore a test-execution stability concern rather than an established product defect. Canvas-not-implemented and React act warnings still appear in the unit output.
- `npm audit --omit=dev --json` returned zero runtime advisories. The complete audit returned 14 affected development-package entries.
- Production browser probes confirmed native dragging places zero signatures and cold offline intake rejects a valid PDF. The reproduction script is `/tmp/signlite-native-drag.cjs`.
- Actual flattening probes confirmed unsupported Unicode errors and the byte-spread backup failure. Rotated and cropped output, delayed autosave readiness, invalid image imports, and cross-tab overwrites were also reproduced during the delegated review.

Prove It Works shaped the use of exported-PDF and native-browser probes instead of relying solely on successful builds. Boundary Discipline shaped the recommendation to validate resource budgets and imported image content before committing them to application state.
