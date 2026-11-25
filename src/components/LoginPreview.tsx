import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { cn } from '../lib/utils';
import { LoginPage } from './LoginPage';
import { buttonClass, Field, inputClass } from './ui';

const GITHUB_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

function GoogleGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

const socialButton = cn(buttonClass, 'w-full py-2.5 text-sm');

/**
 * Dev-only stand-in shown at /#login while sign-in is off (no Clerk key). It mirrors the
 * styled Clerk form so the page can be reviewed, and explains the setup when used.
 */
export function LoginPreview() {
  const [tried, setTried] = useState(false);
  const setup = useRef<HTMLDetailsElement>(null);
  const explain = () => {
    setTried(true);
    if (setup.current) setup.current.open = true;
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    explain();
  };

  return (
    <LoginPage>
      <div className="w-full rounded-2xl border border-line bg-canvas">
        <form onSubmit={submit} className="flex flex-col gap-3 p-6">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Sign in to CaptBot</h2>
              <p className="mt-1 text-sm text-muted">Magic link, Google or GitHub. No password needed.</p>
            </div>
            <span className="shrink-0 rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-accent-700 uppercase dark:bg-accent-900/50 dark:text-accent-300">
              Preview
            </span>
          </div>
          <button type="button" onClick={explain} className={socialButton}>
            <GoogleGlyph />
            Continue with Google
          </button>
          <button type="button" onClick={explain} className={socialButton}>
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
              <path d={GITHUB_PATH} />
            </svg>
            Continue with GitHub
          </button>
          <div className="my-1 flex items-center gap-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <Field label="Email address">
            <input type="email" required placeholder="you@company.com" className={cn(inputClass, 'py-2.5')} />
          </Field>
          <button
            type="submit"
            className="group mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-400"
          >
            Send magic link
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          {tried && (
            <p
              role="status"
              className="anim-rise rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs leading-relaxed text-accent-800 dark:border-accent-900 dark:bg-accent-950/40 dark:text-accent-200"
            >
              Preview only, so nothing was sent. Sign-in turns on once a Clerk key is set up (steps below).
            </p>
          )}
        </form>
        <details ref={setup} className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-3 text-xs font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            Set up sign-in
            <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
          </summary>
          <ol className="flex flex-col gap-3 px-6 pb-5 text-sm leading-relaxed text-ink">
            {[
              'Create an app at clerk.com. Turn on Email verification link, and add Google and GitHub.',
              null,
              'Restart the dev server. This card becomes the real sign-in form.',
            ].map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-100 text-[11px] font-semibold text-accent-700 dark:bg-accent-900/50 dark:text-accent-300">
                  {i + 1}
                </span>
                <span>
                  {text ?? (
                    <>
                      Put its publishable key in <code className="rounded bg-canvas px-1 font-mono text-xs">.env.local</code> as{' '}
                      <code className="rounded bg-canvas px-1 font-mono text-xs break-all">VITE_CLERK_PUBLISHABLE_KEY</code>.
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </details>
      </div>
      <a href="#" className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted transition hover:text-ink">
        <ArrowLeft size={14} />
        Back to the app
      </a>
    </LoginPage>
  );
}
