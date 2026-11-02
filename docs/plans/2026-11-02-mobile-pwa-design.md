# Mobile signing and installable offline app

Date: 2026-11-02

## Decision

Extend the existing queue-focused app to phones and tablets. Keep the selected neutral ink visual system and one shared Work Session/library model. A separate mobile product would duplicate signing behavior. Merely shrinking the desktop UI would leave touch capture and offline relaunch unsupported.

## Implementation lanes

1. Touch editor: accessible sheets for Pages and Library on narrow screens, fit-to-width pages without a desktop minimum scale, generous touch targets, safe-area spacing, explicit text editing, and gesture cleanup for touch cancellation. Preserve desktop panels and shortcuts.
2. Drawing: full-screen mobile dialog, aspect-correct canvas, single active pointer with capture, ignore concurrent palm/finger pointers, use coalesced samples where available, render pen pressure with stable fallback for mouse/touch and legacy stored points. Undo, clear, cancel and save remain visible in small portrait and landscape windows.
3. PWA: local web manifest and icons, production-only service worker with build-versioned precache of public app resources. Only app resources enter Cache Storage, never user files, object URLs or IndexedDB contents. Activation does not force reload or interrupt an active session. Offline launch status is separate from in-memory PDF readiness. Offer browser install when supported and manual iOS instructions otherwise. Retain the document CSP's connect-src 'none', scope any worker fetch permission to the worker script.
4. Documentation: current scope reflects implemented mobile/PWA behavior. Historical decisions and snapshots receive dated supersession context rather than silently rewriting past evidence.

## Acceptance

Write failing unit/interaction tests before feature code. Test production touch flows in Chromium and WebKit emulation where locally available, including draw/save/place/move/resize/edit/download, portrait and landscape, and no page overflow. Test pressure rendering and pointer cancellation separately with synthetic pen input. Verify first visit, offline-ready status, offline reload and fresh document signing, versioned cache lifecycle, install instructions, and that the cache contains only public app resources. Run full typecheck, lint, unit suite, build, and E2E regression suite. Real physical-device/stylus and OS-level install UI cannot be claimed from emulation.
