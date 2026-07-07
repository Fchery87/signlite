---
version: alpha
name: SignLite
description: Quiet-utility design system for a client-side document signer — dense, calm, chrome-free, with one ink-blue accent.

colors:
  # Light mode (canonical — ships first). Dark counterparts carry the -dark suffix.
  background: "#F7F7F5"
  surface: "#FFFFFF"
  surface-sunken: "#EFEFED"
  on-surface: "#1A1A18"
  on-surface-muted: "#6E6E69"
  border: "#E2E2DF"
  border-strong: "#C9C9C4"
  primary: "#3B5BCC"
  on-primary: "#FFFFFF"
  primary-hover: "#3350B4"
  accent-subtle: "#EDF1FC"
  success: "#1F7A45"
  warning: "#8F6400"
  error: "#B3261E"
  background-dark: "#161615"
  surface-dark: "#1E1E1C"
  surface-sunken-dark: "#111110"
  on-surface-dark: "#ECECEA"
  on-surface-muted-dark: "#9A9A94"
  border-dark: "#2E2E2B"
  border-strong-dark: "#44443F"
  primary-dark: "#7B93E8"
  on-primary-dark: "#0E1633"
  primary-hover-dark: "#93A7EE"
  accent-subtle-dark: "#1E2540"
  success-dark: "#5BBF86"
  warning-dark: "#D9A93F"
  error-dark: "#E5726B"

typography:
  display:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.01em
  h1:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  body-strong:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0.01em
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5

rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 10px
  full: 999px

spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 24px
  6: 32px
  7: 48px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: 6px 14px
    height: 30px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: 6px 14px
    height: 30px
  button-primary-disabled:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: 6px 14px
    height: 30px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: 6px 14px
    height: 30px
  button-secondary-hover:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.md}"
    padding: 6px 14px
    height: 30px
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 6px 10px
    height: 30px
  input-text-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 6px 10px
    height: 30px
  tray:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "{spacing.4}"
    width: 264px
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "{spacing.5}"
    width: 480px
  toast:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  status-chip:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
    height: 18px
  status-chip-success:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.success}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
    height: 18px
  status-chip-error:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.error}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
    height: 18px
  drop-target:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "{spacing.7}"
  drop-target-active:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.primary}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "{spacing.7}"
  restore-bar:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: 8px 16px
    height: 40px
  placement-handle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    size: 8px
---

# SignLite Design System

## Overview
SignLite is a client-side document signer used by one desktop professional, daily, in a pinned tab. The design must produce the emotional response of a good hand tool: present, precise, and forgettable. Quiet utility is the whole aesthetic — dense but calm, neutral grays with a single ink-blue accent, borders instead of shadows, and copy that states facts and stops. The document page is the star; the chrome recedes. Two anti-patterns govern everything: this must never look like a consumer SaaS marketing product (gradients, mascots, celebration), and it must never accumulate chrome (tours, tips, badges, decoration without function).

## Colors
The palette is a warm-neutral gray ramp with one accent. `background` (#F7F7F5) is the app chrome; `surface-sunken` (#EFEFED) is the canvas well behind rendered PDF pages, so the white pages read as physical objects lying on a desk. `primary` is ink blue (#3B5BCC) — the color of signature ink — and it is rationed: primary buttons, selection outlines, focus rings, active drop states, and nothing else. `accent-subtle` is its tint for selection fills and the restore bar. Semantic colors (`success`, `warning`, `error`) appear only in status chips and inline messages, never as decoration; all are tuned to ≥4.5:1 on their surfaces (WCAG AA). Dark mode counterparts carry the `-dark` suffix: same relationships, lifted accent (#7B93E8) so it passes AA on dark surfaces. Light mode ships first; dark is a token flip, not a redesign.

## Typography
Inter throughout, bundled locally as woff2 (zero network requests is a product invariant — never load fonts from a CDN in the app; only this doc's HTML mirror may). Inter's neutrality and small-size clarity fit a dense tool UI. The scale is deliberately compressed: `body` at 13px is the workhorse for all UI text; `body-strong` (500) marks labels and button text; `caption` (11px) handles metadata like page counts and status chips; `h2`/`h1` structure trays and modals; `display` (24px) exists for exactly one place — the drop-zone prompt — and should not spread. `mono` (system monospace stack, no extra font file) renders filenames and keyboard shortcuts. Negative letter-spacing only at 15px and above; never track out body text.

## Layout
A base-4 spacing scale (`1`–`7`: 4 to 48px) with density calibrated to "comfortable-tight": components breathe at 8–12px internally, sections separate at 16–24px, and only the drop zone uses 48px. The editor is a fixed three-column frame — thumbnail rail, canvas stage, 264px library tray — with the canvas flexing; panels are full-height with 1px borders, no floating cards. No responsive breakpoints in v1 (desktop-only by product decision), but nothing should hard-break below ~1100px. Alignment beats decoration: when a layout feels wrong, fix the rhythm to the 4px grid before adding any visual element.

## Elevation & Depth
Borders and background shifts, not shadows. Panels and trays separate from the canvas with a 1px `border` line and surface-color changes; interactive raising is expressed by moving from `surface` to `surface-sunken` (pressed) or `accent-subtle` (selected). Exactly two shadow levels exist: rendered PDF pages get a soft paper shadow (0 1px 3px rgba(0,0,0,.10)) to sit on the sunken canvas, and modals/toasts get one floating shadow (0 8px 24px rgba(0,0,0,.14)). Nothing else casts a shadow — if a component seems to need one, its hierarchy is wrong.

## Shapes
Slight rounding, varied by class: `sm` (4px) for small controls and placement handles, `md` (6px) for buttons, inputs, and toasts, `lg` (10px) for modals only, `full` for status chips. Panels, trays, bars, and the drop zone are square (`none`) — they're architecture, not objects. The restraint signals tool-ness: heavily rounded corners read as consumer-friendly, which this brand deliberately is not. Never mix radii within one component class.

## Components
Buttons come in two variants only: `button-primary` (ink blue, one per screen region — Download, Apply to all) and `button-secondary` (bordered surface — everything else); disabled state drops to sunken gray, never a faded blue. Inputs are 30px tall matching buttons, with the focus state swapping the 1px border to `primary` plus a 2px `accent-subtle` ring — the focus ring is the accent's most frequent appearance. The `tray` and panels are flat, border-separated columns. `modal` (draw pad, type pad, import/export) is the only centered floating element, 480px, focus-trapped. `toast` inverts the palette (dark on light mode) so "Done. 12 documents signed." is legible without being loud, bottom-center, 4s. `status-chip` is the batch panel's vocabulary — muted by default, semantic color for signed/needs-review/failed states. `drop-target` is the entire window; its active state floods `accent-subtle` with a dashed `primary` border. `placement-handle` renders as 8px white squares with a 1px `primary` border at the selection's corners; the selection outline itself is 1.5px `primary`. Hover states shift one background step; nothing scales, glows, or animates beyond a 120ms ease-out color transition.

## Do's and Don'ts
**Do:**
- Keep the ink-blue accent rationed to interaction: one primary button per region, selection, focus. If blue appears somewhere non-interactive, remove it.
- Let the PDF page be the brightest, most contrasted object on screen — chrome stays a half-step quieter.
- Snap every dimension to the 4px grid and every string to the voice guide in product-vision.md § Voice & Tone.
- Use borders and surface shifts for hierarchy; reserve the two sanctioned shadows for pages and modals.
- Show state with the chip vocabulary (pending / placed / needs review / signed) — color-coded, terse, lowercase.

**Don't:**
- No gradients, glassmorphism, glows, or decorative illustration — anywhere, ever.
- No celebration: no confetti, no animated checkmarks, no exclamation marks in copy.
- No onboarding chrome: no tours, tooltips-on-first-run, pulsing hotspots, or "pro tip" cards. Empty states carry the instruction.
- No new colors: if a design need seems to demand a color outside this file, the need is misdiagnosed.
- No motion beyond 120ms color/opacity eases — nothing slides, bounces, or springs.
- No CDN assets in the app — fonts and icons ship bundled or not at all.
