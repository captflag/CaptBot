import { LibraryBig, MessagesSquare, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { authEnabled } from '../lib/auth/session';
import { updateSettings, useSettings } from '../lib/settings';
import { cn } from '../lib/utils';
import { Logo } from './Logo';

// Clerk is only downloaded on deployments that have sign-in.
const UserButton = lazy(() => import('@clerk/react').then((m) => ({ default: m.UserButton })));

export type View = 'chat' | 'knowledge';

const VIEWS: { id: View; label: string; icon: typeof MessagesSquare }[] = [
  { id: 'chat', label: 'Chats', icon: MessagesSquare },
  { id: 'knowledge', label: 'Knowledge', icon: LibraryBig },
];

/** Height of one rail button plus the gap under it; the active marker slides by this much. */
const STEP = 52;

const railButton = 'relative grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors';

interface Props {
  view: View;
  onView: (view: View) => void;
  onOpenSettings: () => void;
  /** An answer is being written somewhere in the app. */
  busy: boolean;
}

/** The app's navigation: an icon rail down the left edge on wide screens, a bar along the bottom on phones. */
export function NavRail({ view, onView, onOpenSettings, busy }: Props) {
  const s = useSettings();
  const initials = s.displayName.trim()
    ? s.displayName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'You';
  const dark = s.theme === 'dark';

  return (
    <nav
      aria-label="Main"
      className="relative z-50 flex shrink-0 items-center border-line bg-surface max-md:h-14 max-md:justify-around max-md:border-t max-md:px-2 md:w-[76px] md:flex-col md:gap-2 md:border-r md:py-4"
    >
      <div className="mb-4 hidden md:block">
        <Logo size="md" busy={busy} />
      </div>

      <div className="relative flex gap-2 max-md:contents md:flex-col">
        {/* On the rail, one green tile slides between the pages; on the phone bar each button fills itself. */}
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 hidden h-11 w-11 rounded-xl bg-accent-500 shadow-[0_6px_16px_-6px_var(--color-accent-500)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:block"
          style={{ transform: `translateY(${VIEWS.findIndex((v) => v.id === view) * STEP}px)` }}
        />
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onView(v.id)}
            aria-label={v.label}
            aria-current={view === v.id ? 'page' : undefined}
            title={v.label}
            className={cn(railButton, view === v.id ? 'text-gray-950 max-md:bg-accent-500' : 'text-muted hover:bg-canvas hover:text-ink')}
          >
            <v.icon size={19} strokeWidth={view === v.id ? 2.3 : 1.9} />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 max-md:contents md:mt-auto md:flex-col">
        <div className="grid h-11 w-11 shrink-0 place-items-center">
          {authEnabled ? (
            // Account menu: profile, security and sign out.
            <Suspense fallback={<div className="h-8 w-8" />}>
              <UserButton />
            </Suspense>
          ) : (
            <div
              title={s.displayName.trim() || 'You'}
              className="grid h-9 w-9 place-items-center rounded-xl bg-raised text-[10px] font-bold text-ink ring-1 ring-line"
            >
              {initials}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className={cn(railButton, 'text-muted hover:bg-canvas hover:text-ink')}
        >
          <SettingsIcon size={18} strokeWidth={1.9} />
        </button>
        {/* Light and dark, as a two-way switch whose knob slides. */}
        <div role="radiogroup" aria-label="Theme" className="relative hidden flex-col gap-1 rounded-full border border-line bg-canvas p-1 md:flex">
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-1 left-1 h-7 w-7 rounded-full bg-raised shadow-sm ring-1 ring-line transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              dark && 'translate-y-8',
            )}
          />
          {(
            [
              { value: 'light', label: 'Light theme', icon: Sun },
              { value: 'dark', label: 'Dark theme', icon: Moon },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={dark === (t.value === 'dark')}
              aria-label={t.label}
              title={t.label}
              onClick={() => updateSettings({ theme: t.value })}
              className={cn(
                'relative grid h-7 w-7 place-items-center rounded-full transition-colors',
                dark === (t.value === 'dark') ? 'text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <t.icon size={14} />
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
