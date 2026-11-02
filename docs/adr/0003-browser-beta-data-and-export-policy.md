# Browser beta data and export policy

Date: 2026-11-01
Status: implementation direction accepted, technical qualification recorded separately in release acceptance.

## Context

SignLite is a hosted browser web app. PDFs, signature images, session state, rendering, and export stay in the browser. The audit found unsafe cross-tab clearing, retention transactions that crossed asynchronous lock boundaries, malformed image acceptance, and source PDF actions surviving export.

## Decision

Keep the existing static React/Vite application, Work Session mutation boundary, immutable signature snapshots, revision-checked full-record IndexedDB persistence, and worker delivery path. Do not add a backend, native desktop wrapper, cryptographic signing service, or persistent payload split.

Use Web Locks for origin maintenance coordination and per-session editing authority. Open IndexedDB deletion transactions only after lock acquisition, and recheck revision and expiry within each transaction. History clearing preserves sessions owned elsewhere. Full clear requires exclusive maintenance authority and uses one multi-store transaction. Failures must not reset the initiating editor or report success. Browsers without lock support keep optimistic revision-checked editing but refuse unsafe persistent cleanup.

Seven-day retention is best-effort inactivity cleanup while the application runs. It is not a clock-driven deletion service while the browser is closed. Browser eviction can remove data earlier. The app does not add encryption to stored document/signature bytes. Library exports contain signature images and metadata, not a full Work Session backup.

Apply a bounded restricted PDF export policy to a parsed copy before writing placements. Remove identified JavaScript and Launch actions from supported document, page, annotation, form-field, outline, and action-chain locations. Remove the document JavaScript name tree. Preserve ordinary content, safe URI actions, and destination controls within the supported structure. Reject malformed or over-budget policy traversal rather than fall back to an unchecked export.

This policy is not comprehensive PDF sanitization, secure redaction, malware scanning, attachment filtering, or protection from every viewer behavior. Existing cryptographic signatures may be invalidated when a PDF is modified. SignLite provides visible signature marks, not signer identity verification or certificate-backed signatures.

Imported library PNGs must pass existing count/size/dimension limits and actual decode compatibility checks before a transaction begins. Identical duplicate IDs require equal content and semantic metadata. Conflicts abort the import envelope instead of overwriting or silently skipping different images. Read existing IDs and write additions/counters in one transaction.

## Consequences

### Restricted export supported-location matrix

| Location | Treatment | Regression evidence |
| --- | --- | --- |
| Catalog `OpenAction` | Remove JavaScript/Launch, promote safe `Next`, preserve a valid page destination array | `pdf-export-policy.test.ts`, `pdf-policy.spec.ts` |
| Catalog `Names/JavaScript` | Detach the document script name tree, preserve other names | `pdf-export-policy.test.ts` |
| Catalog/page/annotation `AA`, annotation `A` | Filter direct or indirect actions | Serialized owner matrix and shared-alias tests |
| AcroForm `Fields`, nested field `Kids` | Filter field `A` and `AA` | Serialized field-owner matrix |
| Outlines `First/Last/Next/Prev` | Filter outline `A` and `AA` | Serialized outline-owner matrix |
| Action `Next` dictionary/array | Filter recursively, preserve safe chain members, reject cycles | Chain promotion, shared reference, cycle tests |
| Ordinary resource dictionaries and stream dictionaries | Traverse references without decoding content streams, do not treat a Type3 glyph named `A` as an action | Type3 preservation test |
| Missing references, malformed supported actions, traversal limits | Reject export, never fall back to unchecked bytes | Missing-ref, malformed `AA`/destination, object/depth/work tests |

Default limits are 100,000 distinct visited objects, 128 nesting levels, and 500,000 traversal operations. These are safety limits, not compatibility promises for every PDF. Other action types, attachments, arbitrary embedded content, viewer exploits, and original digital signatures are outside this restricted policy. The browser library's missing-CMap behavior is a font diagnostic and omitted glyphs, not a whole-document parser rejection. Negative tests assert that exact diagnostic rather than pretending a malformed PDF proves resource rejection.

Small explicit maintenance and PDF-policy modules keep new behavior out of the application shell. No database or library-envelope version change is required for this scope. Tests must cover native IndexedDB/lock scheduling, valid image collisions, malformed input, source immutability, actual saved output, geometry, and zero-network signing.

Old open bundles do not automatically participate in a new origin lock. The rollout must require closing/reloading all SignLite tabs. Per-session locks provide additional protection for old editors, but are not a substitute for a versioned protocol if mixed-version safety must be guaranteed against every old writer. Do not enable unsupported destructive behavior by assuming cooperation.

Initial qualification targets desktop Chromium browsers, not a desktop application. Mobile layout remains supported as existing behavior but touch, Firefox, WebKit, screen-reader, target-hardware, real-document, and live-origin acceptance must be recorded independently before broader claims.

## Scope extension, 2026-11-02

The [mobile design](../plans/2026-11-02-mobile-pwa-design.md) implements touch editing, pen-pressure capture, and installable offline use without changing the maintenance, retention, and export policies above. [Release acceptance](../release-acceptance.md) records the browser-emulation evidence. A production-only service worker precaches versioned public application resources. User PDFs, signature images, object URLs, and IndexedDB contents must not enter Cache Storage. Persistent offline-launch readiness is distinct from in-memory PDF readiness. Updates must not force reload or interrupt an active Work Session. Keep the document CSP's `connect-src 'none'` and scope any fetch permission to the worker script.

Recorded desktop-Chromium qualification remains bounded to its revision and tests. Emulation is not real hardware. Synthetic pen input does not prove real-stylus pressure or palm rejection. Physical phones/tablets, real styluses, OS-level install UI, other browsers, and owner/live-origin gates require separate evidence in [release acceptance](../release-acceptance.md).
