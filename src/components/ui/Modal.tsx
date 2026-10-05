import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import { STRINGS } from '../../lib/strings';
import { isTopModal, registerOpenModal } from './modalRegistry';

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

const FOCUSABLE = 'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

function visibleFocusableIn(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((element) => {
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.hidden || element.closest('[hidden]') !== null) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    // jsdom reports no client rects, so layout visibility is only applied when
    // the panel itself has a box. Targets are recomputed on every Tab because
    // a dialog's content changes while it is open.
    const panelHasLayout = panel !== null && panel.getClientRects().length > 0;
    if (!panelHasLayout) return true;
    return element.offsetParent !== null || element === document.activeElement;
  });
}

export function Modal({ open, title, onClose, children }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    // Closing must hand focus back to the control that opened the dialog, or
    // to a valid fallback when that control has since left the document.
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { token, release } = registerOpenModal(panel);
    const focusable = visibleFocusableIn(panel);
    (focusable[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(token)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = visibleFocusableIn(panel);
      if (targets.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const currentIndex = targets.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? targets.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % targets.length;
      event.preventDefault();
      event.stopPropagation();
      targets[nextIndex]?.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      release();
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target && target.isConnected) {
        target.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#161615]/50 p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="surface-card w-full max-w-[480px] rounded-lg p-6 shadow-modal"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-h1 text-ink">
            {title}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label={STRINGS.buttons.close}>
            {STRINGS.buttons.close}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
