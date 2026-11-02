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

## Acceptance boundaries

This evidence covers local production-server behavior and browser emulation. It does not establish physical phone/tablet, real stylus, palm rejection, OS-level installation, assistive-technology user testing, or live-deployment acceptance. No production deployment was performed. Existing jsdom canvas and React act warnings remain visible in unit logs and did not prevent the final suite from passing.
