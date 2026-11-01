# Launch notes

## Release status

SignLite is a static browser web app. The 2026-11-01 hardening work targets a controlled desktop-Chromium browser beta. It does not create a desktop application or authorize production promotion. See `docs/release-acceptance.md` for the current verification record and outstanding owner gates.

## Supported publishing path

Cloudflare Pages receives the exact artifact verified by GitHub Actions CI. Do not configure a second Git-triggered Cloudflare build that bypasses these checks.

1. The owner creates a Cloudflare Pages project and configures `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_PAGES_PROJECT` in the production environment.
2. Configure required production environment approval in GitHub before publishing. No credentials are required for browser document processing.
3. CI uses Node 24/npm 11, runs type/lint/unit/browser/build/audit gates, and verifies the production output.
4. The CI artifact contains `dist` and an external `artifact-manifest.json` receipt. The receipt identifies the commit, exact file set, and SHA-256 hashes.
5. The deployment workflow triggers only from a successful main-branch CI run, checks out its commit, downloads its artifact, and verifies the receipt using Node built-ins. It does not install application dependencies or rebuild.
6. Wrangler publishes only the checked `dist` directory. The receipt is not published as website content.
7. To retry, re-run the successful CI workflow. Manual dispatch without an artifact identity is intentionally disabled.

No live publication is performed by local implementation tests.

## First rollout

Close all SignLite tabs and reopen the site after the update before using persistent destructive maintenance. Older open bundles do not implement the origin maintenance protocol. Browser-local records are not migrated by rolling static files backward.

Keep a library backup and downloaded PDFs before release testing. A library backup is not a full-session backup. Do not delete real browser site data to validate a test case.

## Live-origin acceptance

The owner must record the origin, deployed commit/artifact, date, browser, and results:

- HTTPS and HSTS.
- CSP including `connect-src 'none'`, effective response-header `frame-ancestors`, MIME protection, and referrer policy.
- Static worker and font loading under the production hosting path.
- Signing has no application network requests after readiness.
- Representative PDF preview/export, rotated/cropped geometry, and existing digital-signature warnings.
- Restore, multi-tab protections, safe clearing, and retention warnings.
- Rollback to a known compatible artifact without writing incompatible browser records.

Production URL: not recorded. Live verification: not performed by this implementation session.

## Product limits

SignLite adds visible signature marks, not certificate-backed digital signatures or verified signer identity. Export removes identified JavaScript and Launch actions in supported structures but is not comprehensive PDF sanitization. Modifying a PDF can invalidate existing cryptographic signatures. Retention is best-effort while the app runs, and browser storage has no application-level encryption.
