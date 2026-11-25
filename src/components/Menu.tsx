import { Check, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Lets a menu item close the menu it sits in. */
const CloseMenu = createContext<() => void>(() => {});

interface MenuProps {
  /** The button's accessible name (and its tooltip unless `title` is given). */
  label: string;
  title?: string;
  /** What the button shows. */
  button: ReactNode;
  /** The button's classes; a function gets whether the menu is open. */
  buttonClassName: string | ((open: boolean) => string);
  /** A small caption at the top of the menu. */
  heading?: string;
  /** Width and placement of the panel; it opens below the button, aligned to its right edge. */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * A button that opens a list of actions or choices. Keyboard: Enter, Space or ↓ opens it on the
 * first item; ↑ ↓ Home End move; Esc closes and returns to the button; Tab closes and moves on.
 */
export function Menu({ label, title, button, buttonClassName, heading, panelClassName, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && close(false);
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open, close]);

  const onPanelKey = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') {
      // Handled here, so the dialog or pane behind the menu doesn't close as well.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={typeof buttonClassName === 'function' ? buttonClassName(open) : buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={heading ?? label}
          onKeyDown={onPanelKey}
          className={cn(
            'anim-fade absolute top-full right-0 z-50 mt-1.5 w-56 rounded-xl border border-line bg-raised p-1.5 text-left shadow-xl',
            panelClassName,
          )}
        >
          {heading && <div className="px-2 pt-1 pb-1.5 font-mono text-[10px] tracking-wider text-muted uppercase">{heading}</div>}
          <CloseMenu.Provider value={close}>{children}</CloseMenu.Provider>
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  /** A colour dot, for collections. */
  swatch?: string;
  /** "checkbox" items toggle and keep the menu open; "radio" items pick one and close it. */
  kind?: 'action' | 'checkbox' | 'radio';
  checked?: boolean;
  danger?: boolean;
}

export function MenuItem({ label, onSelect, icon: Icon, swatch, kind = 'action', checked, danger }: MenuItemProps) {
  const close = useContext(CloseMenu);
  const role = kind === 'checkbox' ? 'menuitemcheckbox' : kind === 'radio' ? 'menuitemradio' : 'menuitem';
  return (
    <button
      type="button"
      role={role}
      aria-checked={kind === 'action' ? undefined : Boolean(checked)}
      // Arrow keys move focus between items; Tab leaves the menu, so items stay out of the tab order.
      tabIndex={-1}
      onClick={() => {
        if (kind !== 'checkbox') close();
        onSelect();
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium outline-none hover:bg-canvas focus-visible:bg-canvas focus-visible:ring-2 focus-visible:ring-accent-500/40',
        danger ? 'text-red-600 dark:text-red-400' : 'text-ink',
      )}
    >
      {Icon && <Icon size={14} className={danger ? undefined : 'text-muted'} />}
      {swatch && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatch }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && <Check size={13} className="shrink-0 text-accent-600 dark:text-accent-400" />}
    </button>
  );
}
