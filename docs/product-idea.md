# Product Idea — SignLite (working name)

## One-liner
A lightweight, browser-based document signing app where files never leave your device — upload PDFs/DOCs, drag on your saved signature, initials, dates, and text, sign by touch on mobile, batch-complete stacks of documents, and download instantly with no account and no server.

## Background
The founder wants a clean, simple alternative to bloated e-signature suites. The core insight: most people signing documents are *self-signing* — filling and signing forms someone sent them — and don't need DocuSign's multi-party envelopes, pricing tiers, or account walls. They need upload → place signature → download, fast.

## The problem
People who regularly sign documents (leases, W-9s, NDAs, client agreements, onboarding packets) face two bad options today: heavyweight SaaS platforms (DocuSign at $10–65/user/month, forced accounts, documents stored on vendor servers) or clunky free tools (Smallpdf caps at 2 tasks/day, iLovePDF watermarks, all of them upload your confidential file to their servers). Users complain about: re-drawing their signature every session, no way to batch-sign a stack of similar documents, and mobile signing experiences that require pinch-zooming a desktop layout. Research shows 65% of B2C document signing now happens on mobile, and non-responsive layouts are the top driver of abandonment.

## Target user
**The founder (personal tool, v1):** signs documents regularly, including batches of similar documents in one sitting; works desktop-first; prefers documents never leave the device. v1 is scoped to this workflow.

**If public later:** freelancers, landlords, small agency owners, and HR/admin staff at small businesses who self-sign or countersign 5–50 documents a month — people sent PDFs to "sign and return" who don't control the sending platform. Secondary: privacy-conscious professionals (legal, healthcare-adjacent, finance) who cannot or will not upload confidential documents to a third-party server.

## Proposed solution
A client-side web app (all processing in the browser via pdf.js + pdf-lib — verifiable in DevTools that nothing uploads):

**Core flow (the magic moment):** Drop in a PDF → your pre-saved signature and initials appear in a side tray → drag them onto the page, resize and reposition freely → add date stamps and text boxes → download the signed PDF. Under 60 seconds, no account.

**v1 feature set (desktop, personal workflow):**
- PDF upload (native)
- Saved signature & initials library (drawn, typed in script fonts, or uploaded image) persisted locally (IndexedDB), reusable forever — with export/import so a browser-data wipe can't destroy it
- Drag, drop, resize for every placed element (signature, initials, date, text)
- **Bulk mode (core pillar):** load a stack of documents, place your signature once as a template position (or per-doc), apply to all, download as a zip
- Instant download to device; optional local history via IndexedDB so a reload doesn't lose work

**v2 / if-public candidates:**
- DOC/DOCX converted to PDF client-side on import — **pending a fidelity test on 3 real documents before any build effort** (validation flagged browser Word rendering as the top technical risk)
- Touch/stylus signature capture — full-screen draw pad on mobile with smooth stroke rendering, undo, and pressure-aware lines
- Rotate for placed elements
- Guided "next field" navigation for filling multi-field forms (DocuSign's best UX pattern)
- Optional audit-trail page appended to the PDF (timestamp, device) — competitors paywall this
- "Watch the network tab" privacy proof as a marketing feature (Signegy/AttachKit do this well)
- PWA install for offline signing on phones/tablets

**Deliberately excluded to stay light:** multi-party signing envelopes, email delivery, CRM integrations, notarization, identity verification, cryptographic .p12 certificates.

## Why you
Incumbents are structurally unable to be simple — their revenue depends on accounts, seats, and server-side storage. A client-side architecture has near-zero hosting cost (static files), which makes free-and-fast a sustainable position, not a loss leader.

## Candidates considered

| Candidate | Unfair advantage | Pain level | Reachability | MVP feasibility | Differentiation |
|---|---|---|---|---|---|
| **A. Client-side-only signer (recommended)** — no server, no account, local signature library, bulk mode | 🟡 Architecture, not founder-specific | 🟢 Real, frequent, paid-for pain | 🟢 SEO ("sign PDF without uploading"), Product Hunt, r/selfhosted | 🟢 pdf.js + pdf-lib + canvas; 4–6 weeks | 🟡 Signegy/AttachKit/SignItPDF exist, but none nail saved-library + bulk + polished touch signing together |
| B. Self-hosted multi-user platform (compete with DocuSeal/Documenso) | 🔴 Crowded; well-funded OSS incumbents | 🟢 Real pain | 🟡 Requires devops-savvy audience | 🔴 Multi-signer, SMTP, auth = months | 🔴 DocuSeal already owns "lightweight self-hosted" |
| C. Mobile-first PWA "pocket signer" (touch signing as the hero feature) | 🟡 UX execution bet | 🟢 65%+ of signing is mobile | 🟡 App-store-less distribution is harder | 🟢 Subset of A | 🟡 Strong angle but narrower than A; fold into A instead |

**Call:** Candidate A, absorbing C's mobile-first touch signing as a core pillar rather than a separate product. Candidate B is a losing fight against DocuSeal/Documenso/OpenSign, which already saturate self-hosted multi-party signing.

## Risky assumptions
1. **It sticks after the novelty wears off.** The build only pays off if the founder still reaches for SignLite (not Preview/Markup or old habits) on the next real batch session. Test: use it exclusively for 30 days; note every fallback and why.
2. **Client-side DOC/DOCX → PDF conversion is good enough.** Word rendering fidelity in the browser (e.g., mammoth.js or docx-preview → PDF) is imperfect; if layouts break, "multiple file formats" quietly becomes "PDF only." Convert 3 real DOCX files before committing any build effort.
3. **Scope stays personal.** Mobile polish, PWA, and audit trails are features for a public audience that doesn't exist yet; every week there delays the batch workflow that justifies the build.

_(Market-facing assumptions — discoverability in a saturated SERP, bulk-signing as a wedge, monetization — are deferred to the "If It Goes Public Later" appendix of `docs/validation-report.md`.)_

## Next step
Validated **Strong** as a personal tool (see `docs/validation-report.md`, 2026-07-06). Run the **Product Planner** skill to turn this into a product vision, PRD, and roadmap scoped to the desktop batch-signing v1. This document will pre-fill much of that work.
