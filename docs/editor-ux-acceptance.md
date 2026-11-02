# Editor UX acceptance

Date: 2026-11-02

Product commit: `b0a86b57df3fa2a741f79fc7d8e6c9bd9b1ff9cf`

## Scope

Editor-only warm-neutral redesign: document hierarchy, toolbar, compact thumbnails and navigation, signature/initials/date/text tools, selected-element actions, mobile dialogs, and loading/error/download guidance. Queue, intake, the global shell, local-data controls, and PWA behavior were not redesigned.

## Verification

| Check | Result |
| --- | --- |
| Complete unit suite, `npm test -- --maxWorkers=1` | 402 tests across 48 files passed in one final run. |
| Editor-specific interaction rerun | All 14 editor-view cases passed. |
| Typecheck | Passed. |
| ESLint | Passed. |
| Production build | Passed. Existing large PDF/font chunk warnings remain. |
| Whitespace | `git diff --check` passed. |
| Design reference | All 20 local links and updated editor column metadata verified. |
| Built artifact | 214 file hashes verified against a local receipt for the product commit. This is not a deployment-gate receipt. |
| Desktop signing and editor UX | 3 browser cases passed: responsive editor flow, keyboard download/signing, and native mouse drag. |
| Responsive control reachability | Verified at 1440×900, 1280×800, 1024×768, 390×844, 320×640, and 740×360. |
| Broader browser regression | 19 of 20 initially passed, including accessibility, backup, PDF geometry and all six touch cases. The remaining case used an ambiguous text selector after persistent error feedback was added. |
| Corrected text-export regression | All five cases passed after targeting the persistent alert. Covers Latin/newlines, Greek/Cyrillic, unsupported characters, zoom invariance, and clipping. |
| Touch browser coverage | Chromium Pixel 7 and WebKit iPhone 13 emulation passed draw/place/move/resize/edit/page navigation/download, offline relaunch, short-landscape drawing actions, and phone queue regression. |
| Visual inspection | Reviewed production desktop editor and phone selected-signature screenshots. |

## Issues found and resolved during acceptance

- A viewport-fixed selection toolbar nested in a PDF page could be intercepted by another page's stacking context. Rendering it through a body portal keeps actions above page layers. Responsive browser tests exercise actual button clicks, not just bounding boxes.
- Native drag helper scrolling could move an oversized page between mousedown and dragstart. The regression now begins a real native mouse drag before crossing the viewer. The preview image is not independently draggable, and the asset handle does not refresh itself mid-drag.
- A new multi-action navigation unit test exceeded the default five-second timeout under concurrent local build/browser load. Its explicit 15-second budget matches other editor interaction tests, with unchanged assertions. The final complete suite passed.
- The first complete-suite attempt hit the ten-minute command deadline. A later run with sufficient time completed, and the final run passed all 402 tests. Earlier interrupted or failing runs are not counted as passes.

## Whole-result revalidation

After all implementation and test corrections, the complete feedback loop was run again on unchanged commit `1b73ff06501bfb52564605c949a11d0cc8816d55`:

- Complete unit suite: **402 tests across 48 files passed** in one run.
- Typecheck, ESLint, and a fresh production build passed.
- All seven scoped browser specs ran in **one clean invocation: 23 passed**. This includes editor UX, desktop signing/native drag, accessibility, backup, PDF geometry, text output, and all Chromium/WebKit touch cases.
- The 214-file production artifact was verified against a local receipt for that commit. The tracked source remained unchanged throughout validation, confirmed with `git diff --exit-code` and `git diff --check`.

The initial combined shell command reached the environment's ten-minute execution deadline during its browser phase, after units/types/lint/build had passed. The browser phase was restarted in full as a standalone command against the same unchanged source and fresh artifact, and all 23 cases passed. The interrupted browser attempt is not counted as a pass. This supersedes the need to combine the earlier 19-of-20 browser run with a separate text rerun. It is still scoped editor acceptance, not the complete repository browser suite or live-deployment acceptance.

## Expanded integration validation

The remaining existing browser specs were then exercised without changing application code. An initial 16-case workflow run passed 15 cases and exposed a stale test assumption that Download still lived inside the PDF canvas's `main` element. The same obsolete selector was found in offline and PWA coverage. All three tests now target the named **Document editor** region; the cyclic-export refusal test also targets its persistent alert rather than duplicate toast text.

After those test-only migrations:

- The 22-case offline/security/resource/pressure/failure-delivery group passed.
- **The complete existing Playwright suite passed in one invocation: 59 passed**, including desktop Chromium and both configured phone-emulation projects. This supersedes the earlier scoped-browser-only limitation.
- No application source changed after the final 402-test unit pass and fresh production build. The follow-up changes are limited to three existing browser test selectors and this evidence record.

Offline failure tests intentionally log blocked-resource errors. Chromium also warns that `frame-ancestors` in a meta CSP is ignored; the served framing-header contract is checked separately by the passing headers tests. These logs are not being represented as a clean console assertion.

## Additional editor boundaries

Two additional production-browser tests passed after the 59-case full-suite run. These verify text and date control reachability at 320px, editing and date-format cycling, 150% PDF zoom without document overflow, keyboard focus trapped in a dialog above the portal toolbar, focus restoration, page-two insertion, and cancelling an armed preview without changing existing content or undo history. The 320px text-controls screenshot was reviewed. Typecheck, lint and whitespace checks passed again. These are two targeted additions, not a claim that a new 61-case full-suite invocation was run. Application source remained unchanged.

The same two boundary cases were also run with `hasTouch: true` in Chromium and WebKit through a temporary supplemental configuration: **4 of 4 passed**. This checks coarse-pointer layout and cross-engine dialog/arming behavior. Interactions in these cases still use Playwright click and keyboard APIs, so they do not replace the separate native touch-flow coverage or establish physical touch-device acceptance. No project configuration or application source changed for this supplemental run.

## Acceptance boundaries

This evidence covers local production-server behavior and browser emulation. It does not establish physical phone/tablet, real stylus, palm rejection, OS-level installation, assistive-technology user testing, or live-deployment acceptance. No production deployment was performed. Existing jsdom canvas and React act warnings remain visible in unit logs and did not prevent the final suite from passing.
