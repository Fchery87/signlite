# Release acceptance

## Browser hardening qualification, 2026-11-01

Scope: controlled desktop-Chromium browser beta. No native application, backend, database migration, live deployment, credential setup, or deletion of real browser data is authorized by this qualification. The approved scope is in `docs/plans/2026-11-01-browser-app-hardening-implementation.md`, with policy and supported-location details in ADR 0003.

Technical qualification is being recorded against the new hardening commits, not inferred from the historical table below. The initial fresh baseline had 310 unit passes and 3 timing failures. Its full browser run was externally terminated at 600 seconds. The first integrated browser run had 15 passes, 8 failures, and 13 cases not run. These failures are retained in the implementation logs and are not described as a green baseline.

| Gate | Current evidence |
| --- | --- |
| Exact artifact contract | Standalone Node-built-in checker verifies commit, exact file set, and SHA-256. Receipt stays outside published `dist`. Deploy has no application install or rebuild. Artifact unit tests passed. |
| Storage and lock failure safety | Focused 47-test suite passed after correcting actual native-lock release awaiting, clear failure recovery, and lock cleanup. Native clear/refusal and retained-session tests passed before final regression expansion. |
| PDF resource adapters | Three Chromium tests passed with self-contained embedded-font CMap fixture, dark-glyph pixel counts, standard-font output, and exact missing-CMap diagnostic. Production factory unit tests exercise actual implementation. |
| Restricted PDF policy | Serialized location matrix and malformed/budget tests passed, 18 policy tests. Flatten and worker tests passed in focused qualification. Browser policy export passed with unchanged source and removed OpenAction. |
| PNG and duplicate imports | 20 focused import tests passed, including real PNG decode/export compatibility, same-size differing bytes, envelope rejection, and concurrent ID collision with one additions-counter increment. Browser backup round-trip passed. |
| Isolated clean install and Node 24 | `npm ci` completed in a disposable source copy without altering working dependencies. Explicit Node 24.15.0 typecheck, lint, Vite build, runtime audit and full-toolchain high-severity gate passed. |
| Complete current suites and final artifact | Pending final integrated runs. Focused passes do not substitute for complete qualification. |

Logs are under `$JCODE_SCRATCH_DIR/signlite-implementation/`. Earlier aggregate qualification commands hit external time limits under substantial local contention. Their partial output remains preserved. Expected jsdom canvas limitations and PDF-library Node-build diagnostics are not globally suppressed. Build chunk-size and existing mixed import warnings remain visible.

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
