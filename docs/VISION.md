# Vision — SignLite

> Captured by the Product Planner skill. This file is the source of truth for
> generating product-vision.md, prd.md, and product-roadmap.md. Edit it directly
> and re-run the Product Planner to regenerate downstream documents.

**Created:** 2026-07-06
**Updated:** 2026-07-06

## Founder

- **Name:** Founder (prefers to stay unnamed in docs)
- **Expertise:** Professional developer
- **Background:** A developer who regularly signs documents — including real batches of similar documents in one sitting — and is done with re-drawing signatures in capped free tools or uploading confidential files to third-party servers. Building the tool for personal use first; the door stays open to a public launch later.

## Purpose

- **Who you help:** The founder (v1): a desktop-first professional who signs documents regularly, including batches, and prefers documents never leave the device. If public later: freelancers, landlords, and SMB admins who self-sign 5–50 documents a month, plus privacy-constrained professionals.
- **Problem you solve:** Current options force a bad trade: heavyweight SaaS (accounts, server-side storage, per-seat pricing) or clunky free tools (daily caps, watermarks, uploads of confidential files). All of them make you re-draw your signature every session, and none handle signing a stack of similar documents in one pass.
- **Desired transformation:** Before: a batch of 12 documents means 12 rounds of open → re-draw → place → save in a tool you don't trust. After: drop the stack, place a saved signature once, apply to all, download the zip — minutes, offline-verifiable, nothing uploaded.
- **Why you:** The founder is the user — regular signing including batches, desktop workflow, privacy preference — and controls the roadmap. Structurally, incumbents can't be this simple: their revenue depends on accounts, seats, and server-side storage, while a client-side architecture makes free-and-fast sustainable.

## Product

- **Name:** SignLite
- **One-liner:** SignLite signs PDFs entirely in your browser — saved signatures, batch mode, instant download, nothing ever uploaded.
- **How it works:** Drop a PDF (or a stack) into the browser. Your saved signature and initials appear in a side tray. Drag them onto the page, add dates and text boxes, resize freely. For a stack, place the signature once as a template position and apply it to every document. Download instantly — single PDF or a zip — with all processing done client-side via pdf.js + pdf-lib, verifiable in DevTools.
- **Key capabilities:**
  - PDF upload and client-side rendering (nothing leaves the device)
  - Saved signature & initials library (drawn, typed, or uploaded image) persisted in IndexedDB with export/import
  - Drag, drop, and resize for placed elements: signature, initials, date stamps, text boxes
  - Bulk mode: load a stack, place once as a template position (or per-doc), apply to all, download as zip
  - Local work history via IndexedDB so a reload doesn't lose work
- **Platform:** web
- **Market differentiation:** Every alternative either uploads your document to a server, caps your usage, forces an account, or makes you re-create your signature each session. SignLite does none of those — and it's the only lightweight signer combining a persistent signature library with batch signing. The privacy claim is verifiable, not marketing: open the Network tab and watch nothing upload.
- **Magic moment:** You drop a stack of 12 similar documents, place your saved signature once, hit "apply to all," and download a zip of 12 signed PDFs in under 90 seconds — a task that used to eat an afternoon, done before your coffee cools, with proof in the Network tab that nothing left your machine.

## Audience

- **Primary user:** The founder: a professional developer signing documents regularly on desktop, including recurring batch sessions of similar documents, who refuses to upload confidential files to third-party servers and is tired of re-drawing signatures.
- **Secondary users:**
  - (If public later) Landlords and HR/admin staff with recurring batch-signing rituals — lease renewals, offer letters, policy packets
  - (If public later) Privacy-constrained professionals — legal, healthcare-adjacent, finance — who cannot upload confidential documents to third-party servers
- **Current alternatives:** OS-level annotation (macOS Preview, iOS Markup), Adobe Acrobat's free Fill & Sign, capped free web tools (Smallpdf 2/day, iLovePDF watermarks), print-sign-scan.
- **Frustrations:** None persist a signature across sessions; none handle a stack of documents; the free web tools cap usage, watermark output, and upload confidential files to their servers; OS tools are single-document and fiddly for precise placement.

## Business

- **Revenue model:** free
- **90-day goal:** Daily driver: v1 shipped, the 30-day exclusive-use test passed, every document the founder signs goes through SignLite — including at least 3 real batch sessions completed measurably faster than the old method.
- **6-month vision:** _(suggested — founder deferred)_ SignLite is invisible infrastructure in the founder's workflow: signature library stable for months, batch sessions routine, zero fallbacks to old tools. Optionally hardened for a public "maybe later" launch per the appendix of docs/validation-report.md (fake-door Pro test, privacy-proof positioning) — but only if the itch strikes.
- **Constraints:** Side-project time — nights and weekends, no deadline pressure. Zero-cost infrastructure (static hosting or localhost; no servers, no paid services).
- **Go-to-market:** None for v1 — the market is the founder. If public later: the validated channel plan in docs/validation-report.md (landlord and freelancer communities, privacy communities, "watch the Network tab" positioning).

## Brand Voice

- **Personality:** Quiet utility. Invisible, fast, zero chrome — the tool that says almost nothing and never gets in the way. Confident enough to not explain itself.
- **Tone of voice:** Terse, factual, calm. Says what happened and stops. Success: "Done. 12 documents signed." Error: "This PDF is password-protected. Unlock it and drop it again." Empty state: "Drop a PDF anywhere." No exclamation marks, no mascots, no "Oops!".

> Visual identity (mood, anti-patterns, design tokens) is deliberately not
> captured here — it lives in docs/design.md, generated by the Design System
> skill from image references.

## Tech Stack

- **App type:** web
- **Frontend:** React + Vite + TypeScript, styled with Tailwind CSS — pure static output with no server anywhere, matching the "verifiable in DevTools" promise; the largest ecosystem for drag/drop and canvas work and the best coding-agent support.
- **Backend:** None — the entire product is client-side by design; a backend would contradict the core privacy architecture.
- **Database:** None — on-device storage only: IndexedDB for the signature library and local work history, with JSON/PNG export-import as the durability escape hatch.
- **Auth:** None — no accounts is a feature, not a gap. Single-user personal tool.
- **Payments:** None — revenue model is free; a fake-door Pro test exists in the validation report's appendix if the product ever goes public.
- **Analytics:** None — nothing phones home; keeps "watch the Network tab, zero requests" literally true.
- **Email:** None — no accounts, no notifications, no email surface.
- **Error tracking:** None — local tool for a professional developer who can read a console; Sentry is the first thing to add if it ever goes public.

## Tooling

- **Coding agent:** other: Claude Code, Codex, Pi, and Opencode (multiple agents; roadmap session prompts written agent-agnostic)
