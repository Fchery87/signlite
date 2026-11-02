# SignLite

SignLite is a browser-based PDF editor that adds visible signatures, initials, text, and dates.

It is designed for fast single-document signing and batch signing without uploading files to a server. Documents, signatures, and work history stay local to the browser.

Visible signatures are not certificate-backed digital signatures. SignLite does not verify signer identity or provide a signing audit trail. Export removes identified JavaScript and Launch actions in supported PDF structures but is not comprehensive sanitization. Editing can invalidate existing digital signatures.

## Requirements

- Node.js 24 for CI, or Node.js 26 for supported development
- npm 11

## Current status

- Implemented: mobile touch editing, pressure-aware pen capture, and an installable offline browser app. Phone flows are tested in Chromium and WebKit emulation. See [the mobile design](docs/plans/2026-11-02-mobile-pwa-design.md) and [acceptance evidence](docs/release-acceptance.md).
- Browser emulation and synthetic pen input do not qualify physical phones/tablets, real styluses, or OS install UI. Browser storage can be evicted. Keep signature backups and downloaded documents.
- Release verification and owner acceptance: `docs/release-acceptance.md`
- Tech stack: **React + Vite + TypeScript + Tailwind + pdf.js + pdf-lib + IndexedDB + Playwright + Vitest**

See the product docs for the full plan:

- `docs/prd.md`
- `docs/product-vision.md`
- `docs/product-roadmap.md`
- `docs/design.md`

## Implemented so far

- Zero-network client-side app shell with CSP
- PDF loading and rendering with bundled pdf.js worker/assets
- Drag-and-drop PDF intake with validation
- Signature library with:
  - draw
  - type
  - upload
  - rename/delete
  - export/import
- Page thumbnails and zoomable editor
- Placement layer for:
  - signatures
  - initials
  - date stamps
  - text boxes
- Single-document flatten and download
- Autosave and session restore
- Document queue with row-menu template copying, editor placement, and batch download (not separate batch/apply-to-all panels)
- Batch worker-based flattening and ZIP download
- Keyboard shortcuts and accessibility improvements
- End-to-end zero-network, sign-flow, and batch-flow tests

## Install and use offline

Serve a production build over HTTPS (or localhost), then wait for **Ready to launch offline**. This caches only public app resources. PDFs and signatures remain in the existing local Work Session/library storage, not the app cache. You can then reopen the app offline and open or restore documents.

Use **Install app** when your browser offers it. On iPhone/iPad, open the app in Safari and use Share > Add to Home Screen. Updates wait until all SignLite tabs are closed, so an active signing session is never forcibly reloaded. If app resources are evicted, reconnect and use **Retry offline setup**. Browser storage is not a backup.

## Project structure

```text
signlite/
├── docs/                  Product, roadmap, and design documentation
├── public/                Static assets (fonts, favicon, copied PDF assets)
├── src/
│   ├── components/        UI, editor, library, and batch features
│   ├── db/                IndexedDB schema and facades
│   ├── lib/               Shared helpers and strings
│   ├── pdf/               PDF runtime, coords, flattening
│   ├── stores/            Zustand session store
│   └── workers/           Batch flatten worker
├── tests/
│   ├── e2e/               Playwright flows
│   └── unit/              Vitest unit tests
└── .github/workflows/     CI and deploy workflow scaffolding
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Start the dev server

```bash
npm run dev
```

### 3. Build for production

```bash
npm run build
```

### 4. Preview the production build

```bash
npm run preview
```

## Available scripts

```bash
npm run dev        # start Vite dev server
npm run build      # typecheck + production build
npm run preview    # preview built app
npm run typecheck  # TypeScript checks
npm run lint       # ESLint
npm run test       # Vitest
npm run test:e2e   # Playwright end-to-end tests
npm run verify:production # verify build and write an external artifact receipt
npm run audit:runtime # block moderate-or-higher runtime advisories
npm run audit:tooling # block high-or-higher tooling advisories
```

## Testing

Unit and end-to-end coverage currently includes:

- file intake validation
- session/history restore
- coordinate conversion
- placement interactions
- PDF flattening
- batch worker ZIP flow
- full sign flow
- full batch flow
- zero-network assertions

Run everything locally:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

## Privacy model

SignLite is built around a strict local-first model:

- no backend
- no auth
- no analytics
- no telemetry
- no runtime network dependency during signing flows

The app ships bundled assets locally and uses a strict CSP to support the zero-network goal.

IndexedDB records have no application-level encryption. Browser-profile access, extensions, malware, or compromised same-origin code are outside this privacy guarantee. Library exports are plain JSON with PNG bytes and are not full-session backups.

Seven-day inactivity retention is best-effort cleanup while the app runs, not guaranteed deletion while the browser is closed. Active sessions are preserved. Persistent clearing requires browser lock support. Close and reload all SignLite tabs after a release before using the updated maintenance protocol.

The exact verified artifact is published through Cloudflare Pages only after successful CI and production environment approval. See `docs/launch-notes.md`. Do not run a second hosting build that bypasses verification.

## Known remaining work

The roadmap is not fully complete yet. Remaining items include parts of:

- manual batch timing validation
- real-document founder validation
- durability drill verification
- performance budget verification
- production deployment validation
- 30-day daily-driver logging

Track progress in:

- `docs/product-roadmap.md`
- `docs/daily-driver-log.md`
- `docs/launch-notes.md`

## License

See `LICENSE` and `THIRD_PARTY_NOTICES.md`. The owner remains responsible for confirming the intended application license before release.
