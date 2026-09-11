import { HardDrive, KeyRound, Moon, Sparkles, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Logo } from './Logo';
import { PixelCritter } from './PixelCritter';
import { delay, setTheme, useIsDark } from './signInTheme';

const TICKER = [
  'Hybrid search',
  'BM25 + vectors',
  'Reciprocal rank fusion',
  'Cross-encoder rerank',
  'Deep Research',
  'Cited answers',
  'Knowledge packs',
  'Bring your own model',
];

const DAY_MS = 86_400_000;
const hms = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** UTC clock plus a countdown to the free tier's daily reset. Ticks on the second boundary. */
function UtcClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    id = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="hidden items-center gap-5 font-mono text-[11px] text-gray-400 tabular-nums sm:flex">
      <span>
        UTC <span className="text-gray-600 dark:text-gray-300">{hms(now % DAY_MS)}</span>
      </span>
      <span className="hidden lg:inline">
        Free tier resets in <span className="text-gray-600 dark:text-gray-300">{hms(DAY_MS - (now % DAY_MS))}</span>
      </span>
    </div>
  );
}

function ThemeToggle() {
  const dark = useIsDark();
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

/** A hairline divider that draws itself in along its axis. Position it with className. */
function Rule({ axis, d = 0, className }: { axis: 'x' | 'y'; d?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(axis === 'x' ? 'login-rule-x' : 'login-rule-y', 'bg-gray-200 dark:bg-gray-800', className)}
      style={delay(d)}
    />
  );
}

/** One headline line that rises out of a mask. */
function Line({ d, children }: { d: number; children: ReactNode }) {
  return (
    <span className="login-line">
      <span className="login-rise" style={delay(d)}>
        {children}
      </span>
    </span>
  );
}

function Perk({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
        <div className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{children}</div>
      </div>
    </li>
  );
}

function Ticker() {
  const run = TICKER.map((item) => (
    <span key={item} className="flex shrink-0 items-center">
      <span className="px-4">{item}</span>
      <span className="size-1 rounded-full bg-violet-500" />
    </span>
  ));
  return (
    <div aria-hidden="true" className="login-enter border-t border-gray-200 dark:border-gray-800" style={delay(1150)}>
      <div className="login-ticker overflow-hidden py-3 text-xs font-medium text-gray-500 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] dark:text-gray-400">
        <div className="login-marquee flex w-max">
          <div className="flex shrink-0">{run}</div>
          <div className="flex shrink-0">{run}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Signed-out screen, in the chat app's look: headline and the pixel retriever on one side,
 * the sign-in form (passed in as children) on the other.
 */
export function LoginPage({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
  return (
    <div className="login-root scrollbar-thin h-full overflow-x-hidden overflow-y-auto bg-[#F9FAFB] text-gray-900 dark:bg-[#050505] dark:text-gray-100">
      <div className="flex min-h-full flex-col">
        <header className="relative flex items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <UtcClock />
            <ThemeToggle />
          </div>
          <Rule axis="x" className="bottom-0" />
        </header>

        {/* Phones: intro, sign-in, then the retriever. Wider: intro and retriever on the left, sign-in on the right. */}
        <main className="relative grid flex-1 md:grid-cols-[minmax(0,1.3fr)_minmax(360px,1fr)] md:grid-rows-[auto_1fr_auto]">
          <div className="@container flex flex-col gap-5 px-5 pt-8 pb-8 sm:px-8 md:col-start-1 md:row-start-1 md:pt-12 lg:px-12">
            <div className="login-enter flex items-center gap-2 text-[11px] font-semibold tracking-wider text-gray-400 uppercase" style={delay(200)}>
              <span className="size-1.5 rounded-full bg-violet-500" />
              Knowledge workspace
            </div>
            <h1 className="text-[clamp(2rem,7cqi,3.75rem)] leading-[1.05] font-semibold tracking-tight">
              <Line d={300}>Your documents,</Line>{' '}
              <Line d={400}>
                <span className="text-violet-600 dark:text-violet-400">
                  answered with{' '}
                  <span className="login-underline" style={delay(1000)}>
                    sources.
                  </span>
                </span>
                <span className="login-cite" aria-hidden="true" style={delay(1250)}>
                  1
                </span>
              </Line>
            </h1>
            <p className="login-enter max-w-[34rem] text-[15px] leading-relaxed text-gray-500 dark:text-gray-400" style={delay(650)}>
              Sign in to chat on CaptBot's free tier. Your documents and chats stay in this browser, kept separate for every account.
            </p>
          </div>

          <section
            aria-label="Sign in"
            className="relative flex flex-col px-5 py-8 sm:px-8 md:col-start-2 md:row-span-3 md:row-start-1 md:py-12 lg:px-12"
          >
            <Rule axis="y" d={150} className="top-0 left-0 hidden md:block" />
            <Rule axis="x" d={150} className="top-0 md:hidden" />
            <div className="my-auto flex w-full max-w-[26rem] flex-col gap-8 self-center">
              <div className="login-card flex flex-col gap-4" style={delay(450)}>
                {notice}
                {children}
              </div>
              <ul className="login-enter flex flex-col gap-4" style={delay(900)}>
                <Perk icon={<Sparkles size={15} />} title="Free tier">
                  A daily allowance of AI calls, reset at 00:00 UTC.
                </Perk>
                <Perk icon={<KeyRound size={15} />} title="Your own key">
                  Add one in Settings to go past the limits.
                </Perk>
                <Perk icon={<HardDrive size={15} />} title="Your data">
                  Stays in this browser, separate for every account.
                </Perk>
              </ul>
            </div>
          </section>

          <div className="relative px-5 pb-8 max-md:pt-8 sm:px-8 md:col-start-1 md:row-start-2 lg:px-12">
            <Rule axis="x" d={150} className="top-0 md:hidden" />
            <PixelCritter />
          </div>

          <p
            className="login-enter px-5 pb-8 text-xs leading-relaxed text-gray-400 sm:px-8 md:col-start-1 md:row-start-3 md:pb-12 lg:px-12"
            style={delay(900)}
          >
            <span className="cite-chip">1</span> Every answer cites the passages it came from. Click a citation to open the source with the
            passage highlighted.
          </p>
        </main>

        <Ticker />
      </div>
    </div>
  );
}
