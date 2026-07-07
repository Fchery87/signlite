# Product Vision — SignLite

## 1. Vision & Mission

### Vision Statement
Signing a document — one or a stack of fifty — is a private, sub-minute act that never requires an account, a subscription, or trusting a stranger's server with your files.

### Mission Statement
SignLite signs PDFs entirely in the browser: a persistent signature library, drag-and-place fields, and batch mode across document stacks, with every byte staying on the user's device.

### Founder's Why
The founder is a professional developer who signs documents regularly — and not one at a time. The recurring reality is a stack of similar documents, each demanding the same ritual: open a tool, re-draw a signature that was drawn perfectly last week, drag it into place, export, repeat. The tools available make this worse, not better: free web signers cap usage at two documents a day or watermark the output, and all of them quietly upload confidential files to their servers. The heavyweight alternatives solve a different problem entirely — multi-party envelopes, audit compliance, per-seat pricing — for people sending documents, not people signing them.

This is a build-it-for-yourself product in the most literal sense. The founder is the primary user, the roadmap owner, and the acceptance test. That collapses the usual product risks: there is no persona to guess at, no market to find, no retention curve to worry about beyond one honest question — does the founder still reach for it a month from now?

The architecture is the second half of the why. Incumbents structurally cannot be this simple: their revenue depends on accounts, seats, and server-side document storage. A fully client-side app has none of those dependencies and near-zero running cost, which means the product can stay free, fast, and private forever without a business model propping it up. If it ever goes public, that architecture *is* the pitch.

### Core Values
**Nothing leaves the device — provably.** Not a privacy policy, a verifiable fact: open DevTools, watch the Network tab, see zero requests during signing. Every technical decision is subordinate to this. If a feature requires a server round-trip, the feature is wrong.

**Draw your signature once, ever.** The signature library is the product's memory. It persists across sessions, survives browser data wipes via export/import, and is the reason to come back. Any flow that makes the user re-create a signature is a bug.

**The batch is the unit of work.** Most tools optimize for one document; SignLite optimizes for twelve. Design decisions default to "how does this work across a stack?" — single-document signing is the degenerate case, not the target.

**Say almost nothing.** Quiet utility: terse, factual copy; no onboarding tour, no celebration animations, no "Oops!". The tool's personality is its absence.

**Ship for the founder, design for the door.** v1 is scoped ruthlessly to the founder's desktop workflow, but nothing in the architecture should slam the door on a later public release — no shortcuts that only make sense for an audience of one.

### Strategic Pillars
1. **Client-side or not at all.** All processing via pdf.js + pdf-lib in the browser; static hosting; no backend, no accounts, no telemetry. Resolves every "should we add a server for X?" debate: no.
2. **The founder's real workflow wins ties.** When two designs compete, the one that makes the founder's actual next batch session faster wins — not the one that's more general, more impressive, or more public-ready.
3. **Speed over surface area.** A fast, reliable core flow beats a broad feature set. DOCX support, mobile touch signing, and audit trails all lost to this pillar in validation; they stay lost until the core is a daily habit.
4. **Durability of the library.** IndexedDB is fragile (one "clear browsing data" wipes it), so export/import ships in v1, not as polish. Losing a saved signature once is forgivable; twice means the product failed its own core value.

### Success Looks Like
Twelve months from now, SignLite is boring — in the best sense. The founder hasn't opened Preview, Smallpdf, or a print dialog to sign anything in months. The signature library has been stable since week one (with an exported backup sitting in a home directory). Batch sessions that used to eat an evening take minutes: drop the stack, apply the saved signature to all, download the zip, done before the coffee cools. The 30-day exclusive-use test passed long ago and was forgotten, because there was never a reason to fall back. Total infrastructure spend: $0. If the "maybe public" itch ever struck, the appendix of `docs/validation-report.md` was waiting — but success does not depend on it.

## 2. User Research

### Primary Persona
**The Founder.** A professional developer, desktop-first, who signs documents regularly — leases, contracts, agreements, onboarding paperwork — including recurring batch sessions of several similar documents in one sitting. High technical comfort: reads a console, verifies network behavior in DevTools, understands why IndexedDB needs an export escape hatch. Currently cycles between OS-level annotation and capped free web tools, and resents both — one for its fiddly single-document flow and amnesia about signatures, the other for daily caps, watermarks, and uploading confidential files to servers. Emotional state: not desperate, but persistently irritated; the batch sessions are the flashpoint. What makes them switch is trivially simple — they're building the replacement themselves. What makes them *stay* is the only real question: the tool must beat their muscle memory on the very first batch and never lose a saved signature.

### Secondary Personas
**The landlord / HR admin (if public later).** Runs recurring batch-signing rituals — a dozen lease renewals every season, twenty offer letters per hiring wave. Moderate tech comfort; lives in email and PDFs. Feels the batch pain most acutely of anyone and would be the first external user worth courting, per the validation report's channel plan.

**The privacy-constrained professional (if public later).** Legal, healthcare-adjacent, or finance; contractually or ethically barred from uploading confidential documents to third-party servers. Doesn't need convincing about the problem — needs *proof*, which the "watch the Network tab" demonstration provides literally.

**The founder's future self as maintainer.** A quiet third persona: the person who returns to this codebase after six months away. Clean structure and a boring, well-documented stack are features for this user.

### Jobs To Be Done
- **Functional:** Sign a stack of similar documents in one pass without re-creating a signature; sign a single document in under a minute; fill simple fields (dates, text) on PDFs someone else sent; keep a signature and initials permanently available.
- **Emotional:** Feel certain nothing confidential left the machine; feel the quiet satisfaction of a chore compressed from an evening to a coffee break; never feel nagged, upsold, or watched by the tool.
- **Social:** (Minimal for a personal tool.) Return signed documents promptly and professionally rendered — no watermarks, no "signed with free version" stigma.

### Pain Points
1. **Batch sessions are serial drudgery (severe, recurring).** Every existing tool processes one document at a time; a 12-document stack means 12 full cycles. Frequency: regular, confirmed in validation. Current coping: grinding through serially or procrastinating the stack. This is the pain the product exists for.
2. **Signature amnesia (moderate, every session).** No lightweight tool persists a signature across sessions. Cost: a few minutes and a spike of irritation per document, multiplied across every batch.
3. **Privacy anxiety with confidential documents (moderate, situational).** Free web tools upload files to their servers. The founder simply won't do it for sensitive documents, which forces fallback to clunkier local tools.
4. **Caps and watermarks (minor but rage-inducing).** Smallpdf's 2-task daily limit lands mid-batch by design. It's a paywall dressed as a product decision, and it's the moment that inspired this build.

### Current Alternatives & Competitive Landscape
- **macOS Preview / iOS Markup:** Free, installed, genuinely local. Fine for one document; no signature persistence worth the name across devices, fiddly placement, and zero batch capability. Switching cost from it: none — it has no lock-in.
- **Adobe Acrobat free Fill & Sign:** Capable single-document flow, but account-walled, upsell-heavy, and cloud-oriented. Everything about it wants you in a subscription.
- **Smallpdf / iLovePDF and the free-web-tool tier:** Convenient until the cap or watermark hits; all upload documents server-side. These are what SignLite most directly replaces.
- **Print–sign–scan:** Still alive as the workaround of last resort. Its persistence in 2026 is the clearest evidence the problem is real.
- **Do nothing / procrastinate the stack:** The honest default for batch sessions today, and the behavior SignLite must beat.

### Key Assumptions to Validate
1. **We assume the habit sticks** because the founder built it for their own confirmed workflow. To validate: the 30-day exclusive-use test — every fallback to an old tool gets logged with a reason.
2. **We assume bulk template placement works across real stacks** because batch documents are usually near-identical. To validate: run the first real batch and count how many documents needed manual per-doc adjustment; if most do, the template model needs rethinking.
3. **We assume IndexedDB + export/import is durable enough** for a "forever" signature library. To validate: exercise a browser-data wipe and restore-from-export during Phase 2 testing.
4. **We assume pdf.js and pdf-lib handle the founder's actual document diet** — including scanned PDFs, odd page sizes, and form-flattened files. To validate: run the founder's last ten real documents through the pipeline early in the build.
5. **We assume client-side performance holds for realistic stacks** (say, 20 documents × 10 pages). To validate: profile bulk apply-and-zip on a representative stack before calling Phase 2 done.
6. **We assume single-document signing falls out of the batch design for free.** To validate: time a one-off document; if the batch-first UX makes the simple case slower than Preview, the degenerate case needs its own fast path.

### User Journey Map
Awareness and consideration are collapsed — the founder is the builder. The journey that matters starts at **first use**: a document arrives by email; the founder opens SignLite (pinned tab or localhost), drops the file, draws a signature *once*, places it, downloads. Mild friction expected here: the first session carries the one-time library setup. **Magic moment** lands on the first real batch: a stack of documents dropped together, the saved signature placed once as a template, applied to all, zip downloaded — an afternoon chore finished in ninety seconds, with the Network tab silent the whole time. **Habit formation** is the 30-day exclusive-use window: the pinned tab becomes the reflex, the library quietly persists, and each fallback to an old tool (logged, with reasons) is a design bug to fix. **Advocacy** is optional by design: if the founder ever hands the URL to a friend without caveats, the "maybe public later" door creaks open — but the journey is complete without it.

## 3. Product Strategy

### Product Principles
1. **Zero requests during signing.** The Network tab stays empty from drop to download. This is testable and non-negotiable.
2. **Batch-first, single-document-fast.** Design every flow for the stack; then make sure the one-document case is still under sixty seconds.
3. **The library is sacred.** Signature data persists, exports, imports, and never silently disappears. Treat library loss as a P0 incident even with one user.
4. **No accounts, no onboarding, no chrome.** The first screen is the drop zone. The product explains itself by being obvious, not by touring.
5. **Terse by temperament.** Every string in the UI passes the quiet-utility test: factual, calm, no exclamation marks.
6. **Cut anything that doesn't serve the next real batch session.** Mobile polish, DOCX conversion, audit trails — all real ideas, all deferred, all listed under Out of Scope with re-entry conditions.

### Market Differentiation
Every alternative fails one of four tests: it uploads documents to a server (Smallpdf, iLovePDF, Adobe cloud flows), caps or watermarks usage (the free web tier), demands an account (Adobe, DocuSign-class tools), or forgets your signature between sessions (OS-level annotation). SignLite passes all four simultaneously — and adds the one capability none of them have at any tier: batch signing across a document stack with a single template placement. The differentiation is defensible less by moat than by structural unwillingness: incumbents' revenue models *require* the accounts, storage, and caps that SignLite deletes. For the v1 audience of one, differentiation means something simpler: it must beat macOS Preview on a single document and beat an afternoon of serial signing on a stack. Both are measurable, and both are the acceptance test.

### Magic Moment Design
The magic moment: drop a stack of 12 similar documents, place a saved signature once, hit "apply to all," download a zip of 12 signed PDFs in under 90 seconds — with the Network tab proving nothing left the machine. For this to happen reliably: (1) the signature library must already exist, so first-run library creation has to be smooth and *once-ever*; (2) multi-file drop must be first-class, not a loop over single-file logic; (3) template placement needs a sane coordinate model that tolerates minor page-size variance across the stack; (4) client-side zip generation must handle 12+ documents without freezing the tab — web workers if profiling demands it; (5) the whole pipeline must run offline-verifiable. The shortest path from first open to magic moment is two sessions: session one, sign a single document and save the signature (library seeded); session two, the batch. The MVP scope below makes this achievable — bulk mode is in v1 precisely because the magic moment dies without it.

### MVP Definition
Buildable in well under the 4–8 week envelope at side-project pace, given the founder is a professional developer and the stack is deliberately boring.

- **PDF upload & client-side rendering** — drag-and-drop one or many PDFs, rendered via pdf.js. Essential: it's the canvas everything else draws on. Done when: the founder's ten most recent real PDFs all render correctly.
- **Signature & initials library** — draw (mouse/trackpad), type in script fonts, or upload an image; persisted in IndexedDB; JSON/PNG export and import. Essential: it's the retention hook and core value #2. Done when: a signature drawn today survives a browser restart, an export, a simulated data wipe, and an import.
- **Placement editor** — drag, drop, resize signature, initials, date stamps, and text boxes onto rendered pages; flatten into the PDF via pdf-lib on download. Essential: it's the act of signing. Done when: placed elements land in the downloaded PDF exactly where they sat on screen, across zoom levels.
- **Bulk mode** — load a stack, place elements once as a template position (with per-document override), apply to all, download as zip. Essential: it *is* the magic moment. Done when: a real 10+ document batch completes end-to-end in under two minutes.
- **Local work history** — in-progress placements survive a reload via IndexedDB. Essential: losing work mid-batch would send the founder straight back to old tools. Done when: a mid-session reload restores the open documents and placements.

### Explicitly Out of Scope
- **DOC/DOCX conversion** — tempting because "multi-format" sounds complete; deferred because browser Word rendering fidelity is the top technical risk from validation. Reconsider only after a 3-real-document fidelity test passes; workaround is print-to-PDF first.
- **Mobile touch signing, PWA, pressure-aware strokes** — tempting because the original idea featured them; deferred because the founder is desktop-first and these serve a public audience that doesn't exist yet. Reconsider if the product goes public.
- **Audit-trail page, guided field navigation, rotate** — tempting as competitor-paywalled flex features; deferred as pure scope creep against the batch workflow. Reconsider post-v1 if a real session ever misses them.
- **Multi-party envelopes, email delivery, notarization, cryptographic certificates, CRM anything** — permanently excluded; they are a different product for a different user.
- **Analytics, error tracking, any telemetry** — excluded on principle for v1; "zero requests" is literal. Sentry is the first add if the product ever goes public.

### Feature Priority (MoSCoW)
- **Must Have:** PDF drop & render; draw/type/upload signature + initials; IndexedDB library with export/import; drag/resize placement of signature, initials, date, text; flattened PDF download; bulk template placement + apply-to-all + zip download; reload-safe work history.
- **Should Have:** Per-document override within a batch; keyboard nudging for precise placement; multi-page navigation with thumbnails; a settings drawer for library management.
- **Could Have:** Typed-signature font choices beyond two; recent-documents list; dark mode; drag-reorder of a batch.
- **Won't Have (this time):** DOCX conversion, mobile touch pad, PWA, audit trail, rotate, guided field navigation, and everything in the permanent-exclusion list.

### Core User Flows
**Flow 1 — First signature (library seeding).** Trigger: first-ever visit with a document to sign. Steps: drop PDF → empty library tray prompts "Draw a signature" → draw/type/upload → signature saved to library automatically → drag onto page → download. Outcome: signed PDF plus a permanent library. Success: under three minutes including drawing; signature present after browser restart.

**Flow 2 — Single-document sign (the daily case).** Trigger: a PDF arrives to "sign and return." Steps: drop PDF → saved signature already in tray → drag, place, add date → download. Outcome: signed PDF. Success: under sixty seconds, zero network requests, no signature re-creation.

**Flow 3 — Batch session (the magic moment).** Trigger: a stack of similar documents. Steps: drop all files → arrange/confirm order → place signature and date on the first document as template → review per-doc (override where needed) → apply to all → download zip. Outcome: entire stack signed. Success: 10+ documents in under two minutes; measurably faster than the founder's old serial method.

### Success Metrics
**Primary metric: fallback count during the 30-day exclusive-use test.** Every time the founder signs a document with anything other than SignLite, log it with a reason. Good: ≤3 fallbacks, all explainable (e.g., a DOCX arrived). Great: zero.
**Secondary:** batch session wall-clock time vs. old method (good: 2× faster; great: 5× faster on a 10+ doc stack); single-document time from drop to download (good: <60s; great: <30s); library durability (good: survives 90 days; great: survives a wipe-and-restore drill).
**Leading indicators:** the pinned tab exists by week one; the first real batch happens within two weeks of v1; the signature export sits backed up in the founder's home directory.

### Risks
1. **Scope creep toward imaginary users** (likelihood: high; impact: medium). The gravitational pull of "maybe public later" drags mobile polish and DOCX into v1. Mitigation: the Out of Scope list is part of the acceptance criteria; anything not serving the next real batch session waits.
2. **PDF rendering/writing edge cases** (medium; high). Scanned PDFs, encrypted files, exotic form fields, or unusual page geometries break rendering or flattening. Mitigation: test with the founder's ten most recent real documents in Phase 1, not synthetic samples; handle password-protected files with a terse, clear error.
3. **Bulk performance on real stacks** (medium; medium). Rendering and re-writing 15 documents client-side could freeze the tab. Mitigation: profile early; move pdf-lib work to a web worker if the main thread stalls; stream the zip.
4. **IndexedDB data loss** (medium; high — it attacks the core value). Browser data clearing, private windows, or storage eviction wipes the library. Mitigation: export/import in v1, a visible "last backed up" nudge, and `navigator.storage.persist()` requested on first save.
5. **Template placement fails on heterogeneous stacks** (medium; medium). Real batches may mix page sizes or layouts, making one template position wrong for some documents. Mitigation: per-document override is a Should Have shipping with bulk mode, not an afterthought; store placements in page-relative coordinates.
6. **Habit reversion** (low-medium; high). Muscle memory drags the founder back to Preview for quick one-offs. Mitigation: the single-document path must be genuinely faster than the OS tool — measured, not assumed — and the 30-day test makes reversion visible instead of silent.
7. **Abandonment before the magic moment** (low; high). Side-project entropy: v1 stalls at 80% and never meets a real batch. Mitigation: the roadmap front-loads the magic moment — bulk mode lands in the core phase, not polish — so the payoff arrives while momentum is fresh.

## 4. Brand Strategy

### Positioning Statement
For a desktop professional who signs documents regularly — including stacks of them — and refuses to upload confidential files to third-party servers, SignLite is the browser-based document signer that keeps a permanent signature library and signs entire batches in one pass, entirely on-device. Unlike free web signers and OS annotation tools, SignLite never uploads, never caps, never watermarks, and never asks you to draw your signature twice.

### Brand Personality
Quiet utility, personified: the colleague who fixes the thing, says "done," and goes back to work. They speak in short declarative sentences, never small talk, never exclamation marks. They'd wear plain, well-made clothes you can't remember afterward. They would never: celebrate a routine action with confetti, interrupt work with a tip or a tour, ask for a rating, or say "Oops!". Their confidence shows as absence — no reassurance needed because nothing questionable is happening. When something goes wrong they state the fact and the fix in one breath, then get out of the way.

### Voice & Tone Guide
The voice is constant: terse, factual, calm. Tone shifts only in how much it says — errors earn a second sentence (the fix); success earns as few words as possible.

| Context | DO | DON'T |
|---|---|---|
| First-run / empty state | "Drop a PDF anywhere." | "Welcome to SignLite! 🎉 Let's get you set up with a quick tour!" |
| Empty library tray | "No saved signatures. Draw one to get started." | "Your signature library is feeling lonely!" |
| Success (single) | "Done. Downloaded signed-lease.pdf." | "Awesome! Your document was signed successfully! 🖊️" |
| Success (batch) | "Done. 12 documents signed." | "Wow, you're on fire! 12 docs down!" |
| Error (bad file) | "This PDF is password-protected. Unlock it and drop it again." | "Oops! Something went wrong with your file. 😢" |
| Error (processing) | "Couldn't write page 3 of contract.pdf. The file may be malformed — try re-saving it from its source." | "An unexpected error occurred. Please try again later." |
| Destructive confirm | "Delete this signature? This can't be undone. Export a backup first if you're not sure." | "Are you REALLY sure?? This is permanent!!" |
| Marketing copy (if ever) | "Sign 12 documents in 90 seconds. Nothing leaves your device — check the Network tab." | "The revolutionary AI-powered e-signature platform trusted by thousands!" |

### Messaging Framework
- **Tagline:** "Sign. Nothing leaves."
- **Homepage headline (if public later):** "Sign a stack of PDFs in 90 seconds. Entirely in your browser."
- **Value propositions:** (1) Your signature, saved once, forever — drawn, typed, or uploaded, always in the tray. (2) Batch mode — place once, apply to all, download the zip. (3) Provably private — all processing on-device; verify it yourself in the Network tab.
- **Feature descriptions follow the pattern:** what it does, in one sentence, no adjectives. "Drag your saved signature onto the page. Resize it. Download."
- **Objection handlers:** *"Is this legally valid?"* — For the self-signing use case (signing documents sent to you), a drawn or typed signature image is what the counterparty expects; SignLite doesn't do certified digital signatures, and says so plainly. *"Where's my data stored?"* — In your browser's local storage, on your machine; export a backup anytime. *"What's the catch — how is it free?"* — Static files, no servers, near-zero cost; there is no catch to fund.

### Elevator Pitches
**5-second:** "SignLite signs PDFs in your browser — saved signatures, whole batches at once, and nothing ever uploads."

**30-second:** "Most people signing documents are just signing forms someone sent them — they don't need DocuSign's envelopes and accounts. But the free tools cap you, watermark you, and upload your confidential files to their servers. SignLite runs entirely in the browser: draw your signature once and it's saved forever, drop a stack of documents and sign them all in one pass, and verify in the Network tab that nothing ever left your machine."

**2-minute:** "Here's the problem: I sign documents regularly — sometimes a dozen similar ones in a sitting — and every tool makes it miserable in its own way. The free web signers cap me at two documents a day, watermark the output, and upload my confidential files to their servers. Preview and Markup are local, but they forget my signature every time and can only do one document at a time. And DocuSign-class tools solve a completely different problem — multi-party envelopes and compliance — at per-seat prices, for people *sending* documents, not signing them. So I built SignLite. It's a web app that runs entirely client-side — pdf.js renders, pdf-lib writes, IndexedDB remembers — which means no account, no server, no upload, provably: open DevTools and the Network tab stays empty while you sign. Draw your signature once and it lives in a permanent library. Drop a stack of twelve documents, place the signature once as a template, apply to all, download the zip — ninety seconds for what used to be an afternoon. It's free because static files cost nothing to host, and it's mine because I'm the primary user. If it works for me for thirty days straight, it's a success; if it turns out landlords and privacy-bound professionals want it too, the door's open."

### Competitive Differentiation Narrative
The e-signature market is structured around senders — DocuSign, PandaDoc, and their peers monetize envelopes, seats, and compliance workflows, which is exactly why they can't serve the far larger population of *signers*: people handed a PDF and told to return it. That population today chooses between free web tools (Smallpdf, iLovePDF) that cap usage, watermark output, and store confidential documents server-side, and OS annotation tools that are local but amnesiac and strictly single-document. SignLite occupies the corner none of them can reach: fully client-side, so privacy is a verifiable fact rather than a policy; a persistent signature library, so the tool remembers what every competitor forgets; and batch signing, a capability absent at every price tier of every alternative. Incumbents can't follow without dismantling their own revenue models — accounts, storage, and caps are their business, and their absence is SignLite's product.

## 5. Visual Design

Visual design tokens (colors, typography, spacing, components, motion) live in `docs/design.md`. That file does not yet exist — run the Design System skill with image references to generate it before building. Direction hint from brand: quiet utility — restrained, dense, chrome-free; think Linear/Raycast restraint rather than consumer-app warmth.
