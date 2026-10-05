# Release acceptance

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
