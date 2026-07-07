# SignLite

SignLite is a privacy-first PDF signing app that runs entirely in the browser.

It is designed for fast single-document signing and batch signing without uploading files to a server. Documents, signatures, and work history stay local to the browser.

## Current status

- Roadmap progress: **33/41 tasks complete**
- Current phase: **Phase 2 — Batch Mode — the Magic Moment**
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
- Batch document list and apply-to-all flow
- Batch worker-based flattening and ZIP download
- Keyboard shortcuts and accessibility improvements
- End-to-end zero-network, sign-flow, and batch-flow tests

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

No license file has been added yet.
