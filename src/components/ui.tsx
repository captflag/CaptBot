import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

export const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-white/5 dark:text-gray-100 dark:focus:ring-violet-900/50';

export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10';

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-200';

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Portal to <body>: an ancestor with backdrop-filter (the sidebar) would otherwise
  // become the containing block and trap this "fixed" overlay inside it.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-[#0c0c0c]',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="scrollbar-thin overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div>
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-700')}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

export function IconButton({
  title,
  onClick,
  children,
  className,
  active,
  disabled,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-gray-200',
        active && 'text-violet-600 dark:text-violet-400',
        className,
      )}
    >
      {children}
    </button>
  );
}
