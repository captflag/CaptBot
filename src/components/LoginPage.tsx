import { FileSearch, KeyRound, Moon, Plug, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from './Logo';
import { delay, setTheme, useIsDark } from './signInTheme';

function ThemeToggle() {
  const dark = useIsDark();
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-xl text-muted ring-1 ring-line transition hover:bg-canvas hover:text-ink"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

const FEATURES: { icon: typeof Plug; title: string; text: string }[] = [
  { icon: FileSearch, title: 'Cited answers', text: 'Every claim points at the passage it came from. Click a number to read it in place.' },
  { icon: Plug, title: 'Your own tools', text: 'Connect MCP servers and let answers look things up, with your say on every call.' },
  { icon: KeyRound, title: 'Free to start', text: 'A daily allowance on the free tier. Add your own key in Settings to go past it.' },
];

/** A still of the product: one question, one cited answer, the sources under it. */
function AnswerPreview() {
  return (
    <div aria-hidden="true" className="anim-rise rounded-2xl border border-line bg-canvas p-4" style={delay(360)}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-raised text-[9px] font-bold text-ink ring-1 ring-line">You</span>
        <span className="rounded-2xl rounded-tl-md bg-gray-200/80 px-3 py-1.5 text-[13px] text-ink dark:bg-raised">Which supplier contract ends first?</span>
      </div>
      <div className="mt-3 flex gap-2.5">
        <Logo size="sm" className="self-start" />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-surface p-3 text-[13px] leading-relaxed text-ink">
          The Northwind agreement ends first, on 31 March, with 60 days’ notice to renew
          <span className="cite-chip">1</span>. The Contoso contract runs a year longer<span className="cite-chip">2</span>.
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
            <span className="font-mono text-[9px] tracking-wider text-muted uppercase">Sources</span>
            {['northwind-msa.pdf', 'contoso-renewal.docx'].map((name, i) => (
              <span key={name} className="inline-flex items-center gap-1 rounded-full border border-line py-0.5 pr-2 pl-0.5 text-[10px] font-medium">
                <span className="cite-chip m-0">{i + 1}</span>
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Signed-out screen, in the app's dashboard look: what CaptBot does on one side,
 * the sign-in form (passed in as children) on the other.
 */
export function LoginPage({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-backdrop md:p-3">
      <div className="flex min-h-full flex-col bg-surface text-ink md:rounded-[22px] md:border md:border-line md:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.45)]">
        <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Logo size="md" withWord />
          <ThemeToggle />
        </header>

        <main className="grid flex-1 items-center gap-10 px-5 pt-4 pb-10 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:gap-14 lg:px-14">
          <section className="flex flex-col gap-7">
            <div className="flex flex-col gap-4">
              <div
                className="anim-rise inline-flex w-fit items-center gap-2 rounded-full bg-accent-500/15 px-3 py-1 text-[11px] font-bold tracking-wider text-accent-700 uppercase dark:text-accent-300"
                style={delay(60)}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                Private research assistant
              </div>
              <h1 className="anim-rise font-display text-[clamp(2.1rem,5vw,3.6rem)] leading-[1.04] text-balance" style={delay(120)}>
                Your documents, <span className="text-accent-600 dark:text-accent-400">answered with sources.</span>
              </h1>
              <p className="anim-rise max-w-[36rem] text-[15px] leading-relaxed text-muted" style={delay(200)}>
                Add PDFs, Word files, web pages and notes. Ask in plain words, and get answers that show exactly where each fact came from.
              </p>
            </div>

            <ul className="grid gap-3 sm:grid-cols-3">
              {FEATURES.map((f, i) => (
                <li key={f.title} className="anim-rise rounded-2xl border border-line bg-canvas p-3.5" style={delay(260 + i * 60)}>
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-500 text-gray-950">
                    <f.icon size={15} />
                  </span>
                  <div className="mt-2.5 text-[13px] font-bold">{f.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted">{f.text}</div>
                </li>
              ))}
            </ul>

            <div className="hidden lg:block">
              <AnswerPreview />
            </div>
          </section>

          <section aria-label="Sign in" className="anim-rise flex flex-col gap-4" style={delay(180)}>
            {notice}
            {children}
          </section>
        </main>
      </div>
    </div>
  );
}
