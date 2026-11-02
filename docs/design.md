---
version: current
updated: 2026-11-02
name: SignLite
description: Queue-first PDF signing with warm paper, near-black actions, a prominent saved signature, and click-to-place editing.
implementation:
  tokens: ../tailwind.config.ts
  globalStyles: ../src/index.css
  theme: light
colors:
  background: "#F7F7F5"
  surface: "#FFFFFF"
  surface-sunken: "#EFEFED"
  on-surface: "#1A1A18"
  on-surface-muted: "#6E6E69"
  border: "#E2E2DF"
  primary: "#1A1A18"
  on-primary: "#FFFFFF"
  primary-hover: "#000000"
  accent-subtle: "#EFEEE8"
  success: "#1F7A45"
  warning: "#8F6400"
  error: "#B3261E"
typography:
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
  display: { fontSize: 24px, fontWeight: 600, lineHeight: 1.25, letterSpacing: -0.01em }
  h1: { fontSize: 18px, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.01em }
  h2: { fontSize: 15px, fontWeight: 600, lineHeight: 1.4 }
  body: { fontSize: 13px, lineHeight: 1.5 }
  caption: { fontSize: 11px, lineHeight: 1.45, letterSpacing: 0.01em }
rounded:
  sm: 4px
  md: 6px
  lg: 10px
spacing:
  base: 4px
  common: [4px, 8px, 12px, 16px, 24px, 32px, 48px]
components:
  button:
    variants: [primary, secondary, ghost]
    minHeight: 32px
    coarsePointerMinHeight: 44px
    padding: 6px 12px
  queue:
    maxWidth: 1400px
    desktopSignatureColumn: 296px
    desktopBreakpoint: 1280px
  signature-preview:
    minHeight: 92px
    maxImageHeight: 56px
  editor:
    desktopColumns: "280px minmax(0,1fr) 320px"
    desktopBreakpoint: 1280px
  modal:
    maxWidth: 480px
    padding: "16px, 24px at 640px and above"
    fullscreen: "Opt-in below 640px, safe-area aware"
  placement-handle:
    visibleSize: 8px
    coarsePointerTarget: 28px
shadows:
  page: "0 1px 3px rgba(0,0,0,0.10)"
  modal: "0 8px 24px rgba(0,0,0,0.14)"
  panel: "0 1px 3px rgba(0,0,0,0.08)"
---

# SignLite design system

Current reference for the chosen design and the implementation as of 2026-11-02. The canonical filename is `docs/design.md`. This replaces the original blue-accent, desktop-only reference. [design.html](design.html) is a historical visual preview, not a current specification.

## Chosen design

| Source | Adopted direction | Current implementation |
| --- | --- | --- |
| Prototype B | Batch board as the main workspace | Dense document queue, row selection, filters, filename search, reordering, bulk signature application, and downloads. |
| Prototype A | Warm paper and quiet monochrome controls | Paper `#F7F7F5`, dark ink `#1A1A18`, near-black primary actions, restrained borders, and warm selection fills. |
| Prototype A | Prominent saved-signature card | A dedicated signature dock with a large preview, creation controls, and a chooser for other saved assets. |
| Prototype C | Click-to-place signing screen | A separate document editor with an armed signature, a page-level click or tap target, and direct placement adjustment. |

The result is one responsive product. The batch board manages the work. The editor handles precise signing. Saved signatures stay visible rather than disappearing into a settings menu. There are no duplicate batch or template panels in the editor.

## Visual direction and palette

The interface uses warm-neutral chrome, near-black actions, and white document pages. The PDF and the signature preview have priority over decoration. Borders, spacing, and text weight establish hierarchy. Primary actions do not use cobalt.

| Design name | Tailwind token | Value | Use |
| --- | --- | --- | --- |
| Background | `mist` | `#F7F7F5` | App background and quiet secondary fills. |
| Surface | `surface` | `#FFFFFF` | Queue, signature card, panels, dialogs, and white paper. |
| Sunken surface | `sunken` | `#EFEFED` | Canvas well, segmented controls, and muted states. |
| Ink | `ink` | `#1A1A18` | Main text and interaction outlines. |
| Primary | `accent` | `#1A1A18` | Main action background. The token name does not imply blue. |
| Primary text | `white` | `#FFFFFF` | Text on near-black actions. |
| Primary hover | `black` | `#000000` | Hover on primary actions. |
| Muted text | `quiet` | `#6E6E69` | Metadata and supporting copy. |
| Border | `line` | `#E2E2DF` | Table rules, control borders, and panel edges. |
| Selection fill | `accent-subtle` | `#EFEEE8` | Selected rows, selected signature cards, and armed-placement guidance. |
| Success | `success` | `#1F7A45` | Signed state and success messages. |
| Warning | `warning` | `#8F6400` | Needs-review state and replacement warnings. |
| Error | `danger` | `#B3261E` | Errors and destructive-action labels. |

The chosen colorway is black, cream, and quiet neutrals. A blue signature image is user content, not a blue button or status system. The current queue uses green for Signed, amber for Needs review, and red for Error, always with a text label. Blue status styling from an earlier prototype is not part of the canonical palette.

Light mode is implemented. The old dark counterparts and stronger-border token were proposals, not shipped theme controls, and are not current tokens. Some local styling still sits outside the shared palette, including the editor's pale-blue selected-placement halo and the drawing raster's `#111827` ink. These are implementation exceptions, not permission to introduce a cobalt brand accent. Uploaded signature pixels retain their original colors.

## Typography, spacing, and shape

The UI font stack starts with Inter and falls back to the system sans-serif stack. The current app does not bundle an Inter font file or fetch one from a CDN. The locally shipped Caveat and Homemade Apple fonts are signature fonts, not UI fonts. This distinction matters when comparing screenshots across machines.

| Role | Size | Weight | Line height | Use |
| --- | --- | --- | --- | --- |
| Display | 24px | 600 | 1.25 | Queue title and major empty-state prompts. |
| H1 | 18px | 600 | 1.3 | Document and dialog titles. |
| H2 | 15px | 600 | 1.4 | Panel and signature-card headings. |
| Body | 13px | 400, or 500 for emphasis | 1.5 | Controls, filenames, and working copy. |
| Caption | 11px | 400, or 500 for emphasis | 1.45 | Status labels and metadata. |

Display and H1 use `-0.01em` tracking. Captions use `0.01em`. The system monospace stack is available for technical text and keyboard notation, but filenames do not have to be monospaced. On coarse pointers, form controls have a 16px font-size rule to reduce phone input zoom.

Spacing follows a 4px base with common gaps of 8, 12, 16, 24, and 32px. Not every dimension is a multiple of four: borders, icons, typography, and compact table controls have their own measurements. Shared corner radii are 4px, 6px, and 10px. Main panels and the queue are square-edged. Status dots are round. Drawing containers can use larger rounding, so the old rule that only modals may have rounded corners does not describe the implementation.

## Main workspace: B's batch board

The [document queue](../src/components/queue/DocumentQueue.tsx) is the main working screen after intake. At 1280px and above, a board of up to 1400px has a flexible queue and a 296px signature column. Below that breakpoint, the signature dock follows the queue in a single column.

The queue contains:

- A document count, review count, **Add PDFs**, and **Download all**.
- **All**, **Needs review**, and **Signed** filters with counts, plus filename search.
- Selection checkboxes and a select-all control that acts on the visible rows. Changing a filter does not silently clear an existing selection.
- Dense rows with reordering, a truncated filename, page count where space permits, labelled status, and document actions.
- Drag reordering plus keyboard and touch alternatives. Page counts and some inline row actions hide on narrow screens. The row action menu remains available.
- A floating, near-black selection bar with the selected count, **Apply signature**, **Download selected**, and deselection.

**Apply signature** previews the target count and warns about replacements, review state, and changes to previously signed output before confirmation. It uses the selected saved signature. The separate **Copy placements to all** row action copies a source document's placement template through a target preview. These are distinct operations, not two names for the same action.

Queue downloads own batch progress, cancellation before delivery, ZIP output, and per-document failures. A document with placements can be ready to download without already being Signed. Needs-review documents are not downloadable until resolved. The editor retains its single-document download.

## Saved signature: A's prominent card

The [signature dock](../src/components/queue/SignatureDock.tsx) is a dedicated bordered card, not a small toolbar icon. Its white preview area has a minimum height of 92px, with the image contained at up to 56px high. The preview shows the stored image without tinting or decorative effects.

The card provides **Draw**, **Type**, and **Upload** creation paths. When several assets exist, **Change** opens a chooser with image previews, labels, kinds, and selected state. A still-valid selection survives library refresh. Otherwise, the first available asset becomes the selection. The empty card offers creation rather than a placeholder signature.

The card states that assets are saved in this browser. A nearby local-only panel explains download readiness and export policy. The editor library also supports asset management and backup. The prominent queue card remains the main starting point for applying a saved signature to many documents.

## Signing step: C's click-to-place editor

The [editor](../src/components/editor/EditorView.tsx) separates precise placement from batch management. **All documents** returns to the queue. A queue **Sign** action can open the document with the selected signature already armed. Clicking or tapping an editor-library preview also arms that asset.

Armed mode shows a placement instruction and a cancel action. Clicking or tapping the PDF places the signature at that location and clears armed mode after insertion. A touch scroll gesture does not place an asset. Drag-and-drop remains an optional desktop path, not the only way to sign. The library also offers explicit **Place** and every-page actions.

Selected placements support movement, corner resizing, duplication, copying, deletion, and undo or redo. Text has an explicit **Edit** control for touch use. Dates and text have their own insertion and every-page actions. Placement outlines and controls do not become part of the exported PDF.

At 1280px and above, the editor uses 280px pages/elements, a flexible PDF viewer, and a 320px library. Below that breakpoint, **Pages** and **Library** open focused dialogs instead of persistent sidebars. Choosing a page or inserting an element returns attention to the PDF. Fit mode sizes pages to the available width. The viewer has bounded scrolling, and the selected-element toolbar moves to the bottom on narrow screens.

## Controls, dialogs, depth, and motion

| Component | Current contract |
| --- | --- |
| Primary button | Near-black background, white text, black hover, muted disabled styling. Reserved for the main action in its region. |
| Secondary button | White surface, neutral border, ink text, sunken hover. |
| Ghost button | Transparent control for secondary toolbar and dismiss actions. |
| Button size | Shared minimum height 32px with 6px vertical and 12px horizontal padding. Content can make the control taller. Coarse-pointer buttons have a 44px minimum except resize handles. |
| Inputs | Component-specific heights, not a universal 30px. Queue search is 32px before coarse-pointer rules. Text inputs and selects have a 44px coarse-pointer minimum. |
| Focus | Visible ink ring with a warm-paper offset. Native control semantics and labels remain available. |
| Status | Queue text plus a small colored dot, not a required pill or lowercase chip. The displayed labels come from the shared strings. |
| Modal | Focus-trapped and labelled, with Escape handling, focus restoration, background scroll locking, and top-dialog keyboard ownership. Width is fluid up to 480px. Padding is 16px, then 24px at 640px. |
| Full-screen modal | Opt-in for drawing and editor panels below 640px. Uses dynamic viewport height, safe-area padding, and internal scrolling. At 640px and above, the same content becomes a bounded dialog. |
| Placement handles | 8px visible desktop controls. Coarse-pointer resize targets are 28px with transparent padding. |
| Toast | Ink background, white text, polite status announcement, and a four-second dismissal timer. |

Three named shadows ship: `page` for paper, `modal` for floating dialogs and notifications, and a smaller `panel` shadow for editor panels, menus, and toolbars. Borders remain the main separator. The old two-shadow-only rule is superseded.

Shared buttons have a 100ms transform transition and a small pressed scale of `0.97`. Other controls use short color transitions, and loading placeholders pulse. The old prohibition on every transform or animation is not an implementation constraint. Decorative bouncing, celebration effects, gradients, and glows are not part of the chosen direction.

## Drawing and pressure

The [draw pad](../src/components/library/DrawPad.tsx) supports finger, mouse, and pen input with one active pointer. Pen input records pressure and available coalesced samples. Mouse, touch, and older stored strokes use a stable fallback width. Concurrent contacts do not take over the active stroke. Cancellation and capture loss end the gesture cleanly.

The phone drawing area starts with a taller portrait canvas and uniform backing-coordinate mapping. Once ink exists, its backing dimensions remain fixed so viewport rotation does not clear or clip the drawing. Stationary taps produce visible dots. **Undo**, **Clear**, **Cancel**, and **Save** stay reachable in short windows. Empty drawings cannot be saved. Drawing Undo removes strokes. The editor provides Work Session undo and redo. The draw pad has no redo control.

## Offline and install controls

The app distinguishes **Ready to sign offline** for the loaded runtime from **Ready to launch offline** for the persistent app cache. Neither status promises that open PDFs are stored in Cache Storage. Documents and signatures remain local data with separate storage and backup behavior.

A versioned service worker caches public app resources only. It does not cache user PDFs, signature images, or IndexedDB contents. Failed setup has a retry action, and online repair can replace evicted app-cache entries. Updates wait for SignLite tabs to close rather than forcing a reload during signing.

**Install app** appears only after a browser installation offer. iOS receives Safari and Add to Home Screen guidance when appropriate. Standalone launch suppresses installation guidance. Installation requires HTTPS or localhost and an initial successful app download. Storage can be evicted. [Release acceptance](release-acceptance.md) records tested software paths and separately identifies unverified physical-device, real-stylus, palm-rejection, OS-installation, and live-deployment behavior.

## Accessibility and content

Touch targets, visible focus, labelled dialogs, keyboard alternatives, and live placement announcements support the same queue and editor workflow. Status text carries meaning without relying on color. Compact checkboxes remain distinct from the larger button target rule. A short prompt, empty state, or inline warning explains the next step without tours or decorative badges.

Copy uses direct task language and accurate local-storage claims. A placed visual signature is not a cryptographic certificate or identity verification. Success states describe completed work, not assumed legal validity. Export-policy disclosures remain available before download.

## Source map and maintenance

| Reference | Owns |
| --- | --- |
| [Tailwind configuration](../tailwind.config.ts) | Shared colors, type scale, radii, and named shadows. |
| [Global styles](../src/index.css) | Font stack, touch sizing, safe areas, focus, and narrow placement toolbar. |
| [Document queue](../src/components/queue/DocumentQueue.tsx) | Batch board, selection, filters, status, row actions, and downloads. |
| [Signature dock](../src/components/queue/SignatureDock.tsx) | Saved-signature card and chooser. |
| [Template confirmation](../src/components/queue/TemplateApplyDialog.tsx) | Placement copying and replacement preview. |
| [Editor](../src/components/editor/EditorView.tsx) and [placement layer](../src/components/editor/PlacementLayer.tsx) | Signing navigation and armed placement. |
| [Button](../src/components/ui/Button.tsx) and [modal](../src/components/ui/Modal.tsx) | Shared control and dialog behavior. |
| [Draw pad](../src/components/library/DrawPad.tsx) and [canvas renderer](../src/components/library/canvas.ts) | Capture, pressure, raster rendering, and saved images. |
| [PWA controls](../src/pwa/PwaControls.tsx) | Install and persistent-offline status. |
| [Mobile design](plans/2026-11-02-mobile-pwa-design.md) | Mobile implementation rationale. |
| [Release acceptance](release-acceptance.md) | Verification evidence and acceptance limits. |

This reference describes the shipped design rather than proposing new runtime behavior. Token changes belong in the implementation and this document together. Prototype screenshots and the historical HTML preview do not override the current queue, signature-card, and signing-flow contracts above.
