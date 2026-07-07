# Validation Report — SignLite: client-side, no-account document signing (personal tool)

_Generated: 2026-07-06 (re-run: reframed from market product to personal-use tool, possibly public later)_

## Verdict
**Strong**

As a personal tool, this holds up: you regularly sign documents including real batches, the build is cheap (client-side stack, static hosting, no ops), and the thing you're replacing — re-drawing signatures in capped free tools or uploading confidential files — is a workflow you personally hit every month. Proceed to planning. The one risk to keep watching: scope creep toward features built for hypothetical future users (mobile polish, PWA, audit trails) instead of the desktop batch workflow you actually have.

## Scorecard
_Scored as a personal build: "pain" is yours, "buyer" is you, "urgency" is how often the problem recurs._

| Area | Score | Read |
|---|---:|---|
| Pain intensity | 4/5 | You sign regularly, in batches — the exact workflow (re-draw, place, repeat × N) that current tools make worst. |
| Buyer clarity | 5/5 | The user is you, confirmed: desktop-first, batch-signing, privacy-preferring. No persona guesswork left. |
| Urgency | 3/5 | Recurring monthly friction, not a fire — but frequent enough that the tool pays for its build time within a few batch sessions. |
| Differentiation | 4/5 | Vs. *your* alternatives (Preview/Markup, capped free tools), saved library + bulk mode is a clear personal upgrade; nothing you use today does both. |
| Speed to validate | 5/5 | pdf.js + pdf-lib on static hosting; you validate by using it on your own next stack of documents. |
| Founder advantage | 4/5 | For a personal tool, "I am the user and I control the roadmap" is the advantage — no incumbent can out-fit your own workflow. |

## Core Assumption
After the novelty wears off, you still reach for SignLite instead of your current tools because the saved signature library and bulk mode make your regular batch-signing sessions materially faster.

## Fatal Flaws
| Risk | Severity | Why It Matters | Fast Test |
|---|---|---|---|
| Scope creep toward imaginary users | Medium | Mobile touch polish, PWA install, pressure-aware strokes, and audit trails are all features for a public audience you don't have yet — every week spent there delays the batch workflow that justifies the build. | Write v1's task list; strike anything you won't personally use in the first two weeks. |
| Client-side DOC/DOCX → PDF fidelity (your own #1 risky assumption) | Medium | Browser Word rendering (mammoth.js / docx-preview) breaks layouts; if it fails, "multi-format" silently becomes "PDF only" after the effort is spent. | Before committing to the feature, convert 3 real DOCX files you'd actually sign and eyeball the output. If they break, cut it — you can print-to-PDF first. |
| IndexedDB is fragile storage for a "forever" signature library | Low | One "clear browsing data" wipes your saved signatures and local history — annoying for you, trust-breaking if it ever goes public. | Ship signature export/import (a JSON or PNG download) in v1; it's an hour of work. |

## Problem Reality
- **Pain:** Yours, confirmed: regular signing including multi-document batches, on desktop, with the standard tooling forcing re-drawn signatures, per-day caps, or uploads you'd rather not make. Cost is a chunk of every batch session.
- **Early adopter:** You. Desktop browser, recurring batches of similar documents, saved signature reused across sessions. (If it goes public later, the landlord-doing-lease-renewals persona from the previous report is the closest external match to your own workflow.)
- **Vitamin or painkiller:** Painkiller for the batch sessions — that's where minutes-per-document times N documents actually stings. Vitamin for one-off signatures, which is fine: build for the batch case, let single-doc signing come along for free.

## Competition
- **Current behavior:** Whatever you use today — OS-level annotation, capped free web tools, or print-sign-scan — none of which persist a signature or handle a stack.
- **Real enemy:** Your own habit plus the build-vs-just-cope calculus. The tool wins by being open in a pinned tab and faster than the workaround from the very first batch.
- **Differentiation needed:** None to market — just genuinely faster for *your* stack-of-documents session than doing them one by one elsewhere. That's the whole bar.

## First 10 Customers
Not applicable as a market exercise — the first customer is you. Repurposed as the adoption test:
1. Use SignLite for every document you sign for 30 days; note every time you fall back to an old tool and why.
2. Run one real batch session end-to-end (load stack → place once → apply to all → download zip) and time it against your old method.
3. If "maybe public later" firms up: the previous report's channel plan (r/Landlord, freelancer networks, privacy communities) and its five discovery questions are preserved in the appendix below.

## MVP
- **Build:** Desktop browser flow: drop PDFs → saved signature/initials library (IndexedDB + export/import) → drag, place, resize → **bulk mode** (template position applied across a stack, zip download). Bulk mode is in v1, not v2 — it's your confirmed core use case.
- **Cut from v1:** DOC/DOCX conversion (pending the 3-file fidelity test), full-screen mobile touch pad and pressure-aware strokes, PWA/offline install, audit-trail page, rotate. All are v2-or-if-public candidates.
- **2-week test:** Build it, then sign your next real batch with it. Success = you finish the stack faster than your old method and reach for SignLite unprompted the next time a document arrives. Failure names the pivot: if you drift back to old tools, the friction is probably in file handling (open/save loop), not signing — fix the flow before adding features.

## Appendix — If It Goes Public Later
The market-facing analysis from the previous run, preserved for that day:
- **The flaws that return:** the real competitor is free OS-built-in tooling; no revenue model ("sustainable free" is a cost story, not a business); distribution in a saturated free-tool SERP.
- **The wedge:** batch workflows (landlords, HR admins) and confidentiality-constrained professionals — sell "sign 12 leases in 90 seconds" and "verify in the Network tab that nothing uploads," not "cleaner than Smallpdf."
- **The cheap tests:** fake-door "Pro $29/yr (bulk + audit trail)" button; $50 of search ads on "sign PDF without uploading" measured as cost per signup; the five discovery questions (last three documents signed and with what; last batch-signing session and its frequency; ever refused to upload a confidential doc; does re-drawing your signature bother you; what would 12-docs-in-90-seconds be worth per year).

## Edits Applied to product-idea.md
- **Target user** — reframed founder-first: you (desktop, regular batches, privacy-preferring), with the market personas kept as the "if public later" audience.
- **Proposed solution** — bulk mode promoted to core v1 pillar; mobile touch signing, PWA, and audit trail moved to the v2 / if-public list; DOC/DOCX marked as pending a fidelity test.
- **Risky assumptions** — merged: kept the DOCX-fidelity assumption, replaced the SEO/market-wedge assumptions (deferred to the appendix here) with the personal-adoption and storage-fragility risks.
- `## Candidates considered` preserved verbatim.

## Next Step
Run the **Product Planner** skill — `docs/product-idea.md` is sharpened and will pre-fill its intake; scope the roadmap to the desktop batch-signing v1 above.
