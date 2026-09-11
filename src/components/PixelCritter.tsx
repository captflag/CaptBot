import { FileText } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '../lib/utils';
import { delay } from './signInTheme';

interface Query {
  q: string;
  docs: [string, string, string, string];
  /** Index of the document that answers the question. */
  match: number;
  where: string;
}

/** Made-up questions and files for the retriever to demonstrate on. */
const QUERIES: Query[] = [
  { q: "What's our refund window?", docs: ['handbook.docx', 'pricing.pdf', 'refund-policy.pdf', 'roadmap.md'], match: 2, where: 'page 4' },
  { q: 'Who approves spend over $10k?', docs: ['q3-report.pdf', 'finance-policy.docx', 'onboarding.md', 'contracts.pdf'], match: 1, where: 'section 3.2' },
  { q: 'When does the Acme contract renew?', docs: ['meeting-notes.md', 'roadmap.md', 'pricing.pdf', 'acme-contract.pdf'], match: 3, where: 'page 12' },
  { q: 'How much did revenue grow in Q3?', docs: ['q3-report.pdf', 'board-deck.pdf', 'handbook.docx', 'faq.md'], match: 0, where: 'page 2' },
];

const TICK_MS = 110;
const START_X = 5;
const FOUND_TICKS = 32;
/** Vertical offsets in px, one per tick: a walking hop, and a happy double jump. */
const HOP = [0, -4, -8, -4];
const JOY = [0, -8, -12, -8, 0, -8, -12, -8];
/** Horizontal centre of card i, as a percentage of the row. */
const center = (i: number) => 12.5 + i * 25;

type Phase = 'type' | 'walk' | 'sniff' | 'found' | 'exit';

interface State {
  qi: number;
  /** Ticks since this question started; drives the hop and blink cycles. */
  t: number;
  typed: number;
  /** Critter position, as a percentage of the card row. */
  x: number;
  target: number;
  phase: Phase;
  wait: number;
  /** Bitmask of cards already sniffed without a match. */
  checked: number;
}

const fresh = (qi: number, x = -10): State => ({ qi, t: 0, typed: 0, x, target: 0, phase: 'type', wait: 0, checked: 0 });

/** The end of a search, shown as a still frame when motion is reduced. */
function settled(qi: number): State {
  const { q, match } = QUERIES[qi];
  return { qi, t: 0, typed: q.length, x: center(match), target: match, phase: 'found', wait: 0, checked: (1 << match) - 1 };
}

/** Advances the retriever by one tick. Pure, so it can be passed straight to setState. */
function step(s: State): State {
  const { q, match } = QUERIES[s.qi];
  const n: State = { ...s, t: s.t + 1 };
  switch (s.phase) {
    case 'type':
      // Walk in from the edge while the question types itself, then pause for a beat.
      n.x = Math.min(START_X, s.x + 2);
      if (s.typed < q.length) n.typed = Math.min(q.length, s.typed + 2);
      else if (s.wait < 6) n.wait = s.wait + 1;
      else Object.assign(n, { phase: 'walk', wait: 0 });
      return n;
    case 'walk':
      n.x = Math.min(center(s.target), s.x + 2);
      if (n.x === center(s.target)) Object.assign(n, { phase: 'sniff', wait: 9 });
      return n;
    case 'sniff':
      if (s.wait > 1) n.wait = s.wait - 1;
      else if (s.target === match) Object.assign(n, { phase: 'found', wait: FOUND_TICKS });
      else Object.assign(n, { phase: 'walk', target: s.target + 1, checked: s.checked | (1 << s.target) });
      return n;
    case 'found':
      if (s.wait > 1) n.wait = s.wait - 1;
      else n.phase = 'exit';
      return n;
    case 'exit':
      n.x = s.x + 2.5;
      return n.x > 110 ? fresh((s.qi + 1) % QUERIES.length) : n;
  }
}

type Mood = 'up-l' | 'up-r' | 'down-l' | 'down-r' | 'happy' | 'blink';

// 10×8 sprite, 4px per pixel. X body, W eye white, B pupil or mouth.
const HEAD = ['X.XXXXXX.X', 'XXXXXXXXXX'];
const EYES: Record<Mood, [string, string]> = {
  'up-l': ['XXBWXXBWXX', 'XXWWXXWWXX'],
  'up-r': ['XXWBXXWBXX', 'XXWWXXWWXX'],
  'down-l': ['XXWWXXWWXX', 'XXBWXXBWXX'],
  'down-r': ['XXWWXXWWXX', 'XXWBXXWBXX'],
  happy: ['XXWWXXWWXX', 'XXXXXXXXXX'],
  blink: ['XXXXXXXXXX', 'XXWWXXWWXX'],
};
const BODY = ['XXXXXXXXXX', 'XXXXXXXXXX', 'XXXXXXXXXX'];
const SMILE = ['XXXXXXXXXX', 'XXXBBBBXXX', 'XXXXXXXXXX'];
const LEGS = ['X.XX..XX.X', '.XX.XX.XX.'];
const INK: Record<string, string> = { X: '#8b5cf6', W: '#ffffff', B: '#18181b' };

function Sprite({ mood, stride, puff }: { mood: Mood; stride: 0 | 1; puff: 0 | 1 | null }) {
  const rows = [...HEAD, ...EYES[mood], ...(mood === 'happy' ? SMILE : BODY), LEGS[stride]];
  return (
    <svg width={52} height={32} viewBox="0 0 52 32" shapeRendering="crispEdges" className="block">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x * 4} y={y * 4} width={4} height={4} fill={INK[c]} />)),
      )}
      {/* Sniff sniff: two puffs by the nose, alternating. */}
      {puff !== null && <rect x={puff ? 46 : 42} y={puff ? 18 : 22} width={3} height={3} className="fill-gray-400 dark:fill-gray-500" />}
    </svg>
  );
}

type CardState = 'idle' | 'sniff' | 'checked' | 'match';

function DocCard({ index, name, where, state }: { index: number; name: string; where: string; state: CardState }) {
  return (
    <div
      className={cn(
        'critter-card flex h-[84px] min-w-0 flex-col rounded-lg border p-2.5 transition-[background-color,border-color,opacity] duration-300',
        state === 'match'
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
          : state === 'sniff'
            ? 'border-gray-400 bg-white dark:border-gray-500 dark:bg-white/5'
            : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]',
        state === 'checked' && 'opacity-45',
      )}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-gray-600 dark:text-gray-300">
        <FileText size={11} className="shrink-0" />
        <span className="truncate">{name}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <span className="h-1 w-full bg-gray-200 dark:bg-gray-800" />
        <span className={cn('h-1 w-4/5 transition-colors duration-300', state === 'match' ? 'bg-violet-500' : 'bg-gray-200 dark:bg-gray-800')} />
        <span className="h-1 w-3/5 bg-gray-200 dark:bg-gray-800" />
      </div>
      {state === 'match' && <span className="mt-auto self-end truncate font-mono text-[10px] text-violet-600 dark:text-violet-400">{where}</span>}
    </div>
  );
}

/** The flag the critter plants beside a match. Flies left of the pole on the last card so it stays in view. */
function Flag({ at, flip }: { at: number; flip: boolean }) {
  return (
    <div className="critter-flag absolute bottom-0" style={{ left: `calc(${at}% ${flip ? '-' : '+'} 30px)` }}>
      <div className={cn('flex items-start', flip && 'flex-row-reverse')}>
        <span className="h-9 w-0.5 bg-gray-900 dark:bg-gray-100" />
        <span className="bg-violet-500 px-1.5 py-1 font-mono text-[10px] leading-none font-semibold text-white">[1]</span>
      </div>
    </div>
  );
}

/**
 * Login hero: an 8-bit retriever hops across four documents, sniffs each one and plants a
 * citation flag on the one that answers the question. Click for the next question.
 */
export function PixelCritter() {
  const root = useRef<HTMLElement>(null);
  const [reduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [s, setS] = useState<State>(() => (reduce ? settled(0) : fresh(0, START_X)));
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(el);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const running = !reduce && onScreen && pageVisible;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setS(step), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  const next = () => setS((cur) => (reduce ? settled : fresh)((cur.qi + 1) % QUERIES.length));

  const query = QUERIES[s.qi];
  const found = s.phase === 'found' || s.phase === 'exit';
  const moving = s.phase === 'walk' || s.phase === 'exit' || (s.phase === 'type' && s.x < START_X);
  const sinceFound = FOUND_TICKS - s.wait;

  let y = 0;
  if (moving) y = HOP[s.t % HOP.length];
  else if (s.phase === 'sniff') y = s.t % 2 ? 2 : 0;
  else if (s.phase === 'found' && !reduce && sinceFound < JOY.length) y = JOY[sinceFound];

  const mood: Mood =
    s.phase === 'found' ? 'happy' : s.phase === 'sniff' ? (s.t % 4 < 2 ? 'down-l' : 'down-r') : s.phase === 'type' ? (s.t % 30 === 29 ? 'blink' : 'up-l') : 'up-r';

  const cardState = (i: number): CardState =>
    found && i === query.match ? 'match' : s.phase === 'sniff' && i === s.target ? 'sniff' : s.checked & (1 << i) ? 'checked' : 'idle';

  return (
    <figure
      ref={root}
      className="login-enter relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#0f0f0f]"
      style={delay(520)}
    >
      <div aria-hidden="true" className="flex items-center justify-between gap-4 px-4 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold tracking-wider text-violet-600 uppercase dark:text-violet-400">Question</span>
          <span className="truncate text-sm text-gray-700 dark:text-gray-200">
            {query.q.slice(0, s.typed)}
            {s.phase === 'type' && <span className="critter-caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-violet-500" />}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-gray-400 tabular-nums">
          {s.phase === 'type' ? '4 docs' : `${s.target + 1} / 4`}
        </span>
      </div>

      <div aria-hidden="true" className="login-dotgrid relative h-[200px]">
        <div className="absolute inset-x-4 bottom-4 grid grid-cols-4 gap-2 sm:gap-3">
          {query.docs.map((name, i) => (
            <DocCard key={`${s.qi}-${i}`} index={i} name={name} where={query.where} state={cardState(i)} />
          ))}
        </div>
        {/* Ground level: the top edge of the cards. */}
        <div className="absolute inset-x-4 bottom-[100px]">
          {found && <Flag at={center(query.match)} flip={query.match === 3} />}
          <span
            className="absolute -bottom-0.5 h-1 bg-gray-300 dark:bg-gray-700"
            style={{ left: `${s.x}%`, width: 28 + y, transform: 'translateX(-50%)' }}
          />
          <div className="absolute bottom-0" style={{ left: `${s.x}%`, transform: `translate(-50%, ${y}px)` }}>
            <Sprite mood={mood} stride={moving ? ((s.t % 2) as 0 | 1) : 0} puff={s.phase === 'sniff' ? ((s.t % 2) as 0 | 1) : null} />
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-4 border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
      >
        <span className="truncate">
          {found ? (
            <>
              Found it in <span className="font-medium text-violet-600 dark:text-violet-400">{query.docs[query.match]}</span>, {query.where}
            </>
          ) : s.phase === 'type' ? (
            'Reading your question…'
          ) : (
            <>
              Sniffing <span className="font-medium text-gray-700 dark:text-gray-200">{query.docs[s.target]}</span>…
            </>
          )}
        </span>
        <span className="hidden shrink-0 text-gray-400 sm:inline">Click for another question</span>
      </div>

      <button
        type="button"
        onClick={next}
        aria-label="Show another question"
        className="absolute inset-0 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
      />
      <figcaption className="sr-only">
        Animation: a pixel retriever hops across four documents, sniffs each one and plants a flag on the one that answers the question.
      </figcaption>
    </figure>
  );
}
