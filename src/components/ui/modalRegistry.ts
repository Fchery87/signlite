let openModalCount = 0;
const panels = new Map<symbol, HTMLElement>();
const stack: symbol[] = [];

/** Registers an open Modal and returns the token the dialog must use to
 *  decide whether it is on top, plus the matching release. The same token
 *  has to serve both. A second token minted by the caller can never match
 *  `isTopModal`, which would leave Escape and Tab as no-ops. */
export function registerOpenModal(panel: HTMLElement | null): { token: symbol; release: () => void } {
  const token = Symbol('modal');
  stack.push(token);
  if (panel) panels.set(token, panel);
  openModalCount += 1;
  return {
    token,
    release: () => {
      const index = stack.lastIndexOf(token);
      if (index !== -1) stack.splice(index, 1);
      panels.delete(token);
      openModalCount -= 1;
    }
  };
}

/** True while any Modal is open, so global shortcuts can stand down. */
export function isAnyModalOpen() {
  return openModalCount > 0;
}

function nearestDialog(active: HTMLElement): symbol | null {
  let node: HTMLElement | null = active;
  while (node) {
    const owner = stack.find((candidate) => panels.get(candidate) === node);
    if (owner) return owner;
    node = node.parentElement;
  }
  return null;
}

/** True only for the dialog that owns the keyboard. That is the nearest
 *  dialog ancestor of the focused element, so a nested dialog wins even
 *  though both panels contain the focused control. When focus is outside
 *  every dialog, the last registered dialog owns the keys. */
export function isTopModal(token: symbol) {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const nearest = nearestDialog(active);
    if (nearest) return nearest === token;
  }
  return stack[stack.length - 1] === token;
}
