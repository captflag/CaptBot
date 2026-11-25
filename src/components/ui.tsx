import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** What Tab can reach inside a box: focusable, in the tab order, and shown. */
const tabbable = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);

/**
 * Keeps Tab inside an open dialog, and puts focus back where it was when the dialog closes
 * (unless whatever the dialog did has already moved it somewhere).
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open = true) {
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) (tabbable(box)[0] ?? box).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const items = tabbable(ref.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const now = document.activeElement;
      if ((!now || now === document.body) && before?.isConnected) before.focus();
    };
  }, [ref, open]);
}

export const inputClass =
  'w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-muted outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20';

export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50';

/** Small square buttons that only show an icon. */
export const iconButtonClass = 'rounded-md p-1.5 text-muted transition hover:bg-canvas hover:text-ink disabled:opacity-40';

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-bold text-gray-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50';

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

  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, open);

  if (!open) return null;
  // Portal to <body>: an ancestor with backdrop-filter (the sidebar) would otherwise
  // become the containing block and trap this "fixed" overlay inside it.
  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('anim-rise flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl', className)}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-base leading-none text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted transition hover:bg-canvas hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="scrollbar-thin overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-500' : 'bg-line')}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-muted">{hint}</span>}
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
      className={cn(iconButtonClass, active && 'text-accent-600 dark:text-accent-400', className)}
    >
      {children}
    </button>
  );
}
