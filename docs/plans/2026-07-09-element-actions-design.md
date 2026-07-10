# Element actions, elements panel, and undo/redo

Date: 2026-07-09

## Scope

1. **Selection toolbar for all element types.** The floating toolbar (today only
   on text/date) appears for every selected placement. It keeps the existing
   type-specific controls and adds Duplicate, Copy, and Delete for all types.
2. **Copy/paste across pages.** Copy remembers the placement on an in-app
   clipboard (session store, not persisted). Ctrl+V pastes it at the same
   position on the currently active page and selects it. Ctrl+C copies the
   selected placement. A toast explains the paste shortcut after copying.
3. **Elements panel.** Left sidebar, under Pages. Lists every placement in the
   current document (type label, short text preview, page number) with a
   per-row delete button. Clicking a row selects the placement and jumps to
   its page (same pin behavior as thumbnails). The selected row is highlighted.
4. **Undo/redo.** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y plus header buttons. Snapshot
   history of `documents` + `templatePlacements` (structural sharing keeps
   snapshots cheap), capped at 50 entries.
5. **Ctrl+D** duplicates the selected placement.

## History design

- `pushHistory(coalesceKey?)` captures the current snapshot into `past` and
  clears `future`. Discrete store actions (add, remove, duplicate, paste,
  apply-template) push internally.
- `updatePlacement` does **not** push — it fires per pointer-move. Gesture
  owners push at the boundary instead: pointer-down before drag/resize, and
  coalesced keys for typing (`text:{id}`), font size (`fontSize:{id}`), and
  keyboard nudges (`nudge:{id}`). Coalescing skips a push when the same key
  repeats within 1 second, so one undo reverses one gesture.
- Undo/redo restores the snapshot and drops the placement selection if the
  selected placement no longer exists.
- Document-level operations (add/remove/reorder documents, replace/reset
  session) clear the history; undo only spans placement edits.

## Out of scope (deliberate)

Snap-to-alignment guides, multi-select, checkbox fields, zoom shortcuts —
candidates for follow-ups.
