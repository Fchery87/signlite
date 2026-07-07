import { useEffect } from 'react';

type ToastProps = {
  id: string;
  message: string;
  onDismiss: (id: string) => void;
};

export function Toast({ id, message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), 4000);
    return () => window.clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div className="rounded-md bg-ink px-3 py-2 text-body text-white shadow-modal" role="status" aria-live="polite">
      {message}
    </div>
  );
}
