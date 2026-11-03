import type { ReactNode } from 'react';
import { Modal } from '../ui';
import { useWideLayout } from './useWideLayout';

export function EditorPanel({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const wide = useWideLayout();
  if (wide) return <aside aria-label={title} className="flex min-h-0 flex-col gap-3 overflow-auto">{children}</aside>;
  return <Modal open={open} title={title} onClose={onClose} mobileFullscreen>{children}</Modal>;
}
