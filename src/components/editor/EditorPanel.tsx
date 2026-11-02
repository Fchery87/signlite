import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../ui';

export function EditorPanel({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia('(min-width: 1280px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (wide) return <aside className="flex min-h-0 flex-col gap-4 overflow-auto">{children}</aside>;
  return <Modal open={open} title={title} onClose={onClose} mobileFullscreen>{children}</Modal>;
}
