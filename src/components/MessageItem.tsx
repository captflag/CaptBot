import {
  Bookmark,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  ExternalLink,
  Info,
  KeyRound,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  Plug,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { lazy, memo, Suspense, useMemo, useState, type FormEvent } from 'react';
import { extractCitations } from '../lib/rag/citations';
import type { ToolDecision } from '../lib/rag/answer';
import { CHAT_PRESETS, updateSettings, useSettings } from '../lib/settings';
import type { ChatMessage, ChatProviderId, ResearchStep, RetrievalTrace, SourceRef, ToolRun, WebSource } from '../lib/types';
import { cn, plural } from '../lib/utils';
import { Logo } from './Logo';
import { AnswerLoader } from './AnswerLoader';
import { Markdown } from './Markdown';
import { buttonClass, IconButton, inputClass, primaryButtonClass } from './ui';

const ChartBlock = lazy(() => import('./ChartBlock'));

interface Props {
  message: ChatMessage;
  streaming: boolean;
  canRetry: boolean;
  /** No reply is being written, so a sent message can be edited and asked again. */
  canEdit: boolean;
  onCite: (message: ChatMessage, n: number) => void;
  onRetry: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage, text: string) => void;
  onPin: (message: ChatMessage) => void;
  /** Answers a tool call that is waiting to run. */
  onToolDecision: (runId: string, decision: ToolDecision) => void;
  onSavePrompt: (text: string) => void;
  onOpenSettings: () => void;
  /** Ready documents the chat searches, for the live status ("Searching 4 documents…"). */
  docsInScope: number;
}

/** A ```json array of records with numeric fields becomes a chart under the answer. */
function detectChartData(text: string): Record<string, unknown>[] | null {
  for (const m of text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    try {
      const data: unknown = JSON.parse(m[1]);
      if (
        Array.isArray(data) &&
        data.length >= 2 &&
        data.length <= 60 &&
        data.every((r) => r && typeof r === 'object' && !Array.isArray(r)) &&
        Object.values(data[0] as object).some((v) => typeof v === 'number')
      ) {
        return data as Record<string, unknown>[];
      }
    } catch {
      // not JSON; ignore
    }
  }
  return null;
}

const RUN_LABEL: Record<ToolRun['status'], string> = {
  approval: 'Waiting for you',
  running: 'Running',
  done: 'Done',
  error: 'Failed',
  denied: 'Not run',
};

/** One tool call: what ran, with what, and what came back; or the question whether it may run. */
function ToolRunRow({ run, onDecide }: { run: ToolRun; onDecide: (decision: ToolDecision) => void }) {
  const waiting = run.status === 'approval';
  const tone =
    run.status === 'done'
      ? 'text-accent-700 dark:text-accent-300'
      : run.status === 'error'
        ? 'text-red-600 dark:text-red-400'
        : run.status === 'denied'
          ? 'text-muted'
          : 'text-amber-700 dark:text-amber-400';
  if (!run.tool) {
    // The connector itself could not be reached.
    return (
      <li className="flex items-start gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400">
        <TriangleAlert size={13} className="mt-px shrink-0" />
        <span>{run.output ?? `Could not reach ${run.connector}.`}</span>
      </li>
    );
  }
  return (
    <li className={cn('px-3 py-2', waiting && 'bg-amber-500/10')}>
      <details open={waiting} className="group/run">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
          {run.status === 'running' ? (
            <LoaderCircle size={13} className="shrink-0 animate-spin text-amber-600" />
          ) : (
            <Plug size={13} className={cn('shrink-0', tone)} />
          )}
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-ink">{run.tool}</span>
            <span className="text-muted"> · {run.connector}</span>
          </span>
          <span className={cn('shrink-0 font-medium', tone)}>{RUN_LABEL[run.status]}</span>
          <ChevronDown size={13} className="shrink-0 text-muted transition group-open/run:rotate-180" />
        </summary>
        {waiting && (
          <p className="mt-2 text-xs leading-relaxed text-ink">
            CaptBot wants to run <b>{run.tool}</b> on <b>{run.connector}</b> with the input below. Check it before you allow it: whatever it sends goes to that
            server.
          </p>
        )}
        {run.args && run.args !== '{}' && (
          <pre className="scrollbar-thin mt-2 max-h-40 overflow-auto rounded-lg bg-canvas p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink ring-1 ring-line">
            {run.args}
          </pre>
        )}
        {run.output && !waiting && (
          <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto rounded-lg bg-canvas p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted ring-1 ring-line">
            {run.output}
          </pre>
        )}
        {waiting && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onDecide('once')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-bold text-gray-950 hover:bg-accent-400"
            >
              <Check size={13} /> Allow once
            </button>
            <button
              type="button"
              onClick={() => onDecide('always')}
              title={`Run ${run.tool} without asking from now on. You can take this back in Settings, Connectors.`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-canvas px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line hover:bg-raised"
            >
              <ShieldCheck size={13} /> Always allow
            </button>
            <button
              type="button"
              onClick={() => onDecide('deny')}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              <X size={13} /> Deny
            </button>
          </div>
        )}
      </details>
    </li>
  );
}

function ToolRuns({ runs, onDecide }: { runs: ToolRun[]; onDecide: (runId: string, decision: ToolDecision) => void }) {
  return (
    <ul aria-label="Tool calls" className="mb-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
      {runs.map((r) => (
        <ToolRunRow key={r.id} run={r} onDecide={(d) => onDecide(r.id, d)} />
      ))}
    </ul>
  );
}

function StepIcon({ status }: { status: ResearchStep['status'] }) {
  if (status === 'running') return <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin text-accent-500" />;
  if (status === 'error') return <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />;
  return <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />;
}

function Steps({ steps, done }: { steps: ResearchStep[]; done: boolean }) {
  const [open, setOpen] = useState(() => !done);
  const expanded = !done || open;
  return (
    <div className="mb-3 rounded-xl border border-accent-100 bg-accent-50/50 dark:border-accent-900/40 dark:bg-accent-950/20">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!done}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-accent-700 dark:text-accent-300"
      >
        <BrainCircuit size={14} className={cn(!done && 'animate-pulse')} />
        Deep Research
        <span className="ml-auto font-normal text-accent-700 dark:text-accent-400">{done ? plural(steps.length, 'step') : 'working…'}</span>
        {done && <ChevronDown size={14} className={cn('transition', expanded && 'rotate-180')} />}
      </button>
      {expanded && (
        <ol className="space-y-1.5 px-3 pb-3">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-xs">
              <StepIcon status={s.status} />
              <span className="min-w-0">
                <span className="text-ink">{s.label}</span>
                {s.detail && <span className="block text-muted">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SourceCard({ source, cited, onOpen }: { source: SourceRef; cited: boolean; onOpen: (n: number) => void }) {
  const meta = [source.headingPath.join(' › '), source.page ? `p. ${source.page}` : ''].filter(Boolean).join(' · ');
  return (
    <button
      onClick={() => onOpen(source.n)}
      className={cn(
        'lift flex w-full items-start gap-2.5 rounded-xl border bg-surface p-2.5 text-left hover:border-accent-400 dark:hover:border-accent-600',
        cited ? 'border-line' : 'border-dashed border-line opacity-80',
      )}
    >
      <span className="cite-chip mt-0.5 shrink-0">{source.n}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">{source.docName}</span>
        {meta && <span className="block truncate text-[11px] text-muted">{meta}</span>}
        <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{source.text}</span>
      </span>
    </button>
  );
}

function SourceList({ sources, content, streaming, onOpen }: { sources: SourceRef[]; content: string; streaming: boolean; onOpen: (n: number) => void }) {
  const [cards, setCards] = useState(false);
  const cited = useMemo(() => extractCitations(content, sources.length), [content, sources.length]);
  if (streaming) return null;
  const citedSet = new Set(cited);
  // Cited passages first, in the order the answer cites them; the rest were retrieved but not used.
  const ordered = [...cited.map((n) => sources[n - 1]), ...sources.filter((s) => !citedSet.has(s.n))];
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] tracking-wider text-muted uppercase">Sources</span>
        {ordered.map((s) => (
          <button
            key={s.n}
            type="button"
            onClick={() => onOpen(s.n)}
            title={`${s.docName}${s.page ? `, p. ${s.page}` : ''}${citedSet.has(s.n) ? '' : ' (retrieved, not cited)'}`}
            className={cn(
              'lift inline-flex max-w-[200px] items-center gap-1.5 rounded-full border bg-surface py-0.5 pr-2.5 pl-0.5 text-[11px] font-medium text-ink',
              citedSet.has(s.n) ? 'border-line' : 'border-dashed border-line text-muted',
            )}
          >
            <span className="cite-chip pointer-events-none m-0">{s.n}</span>
            <span className="truncate">{s.docName}</span>
          </button>
        ))}
        <button type="button" onClick={() => setCards((v) => !v)} aria-expanded={cards} className="ml-1 text-[11px] font-semibold text-muted hover:text-ink">
          {cards ? 'Hide passages' : 'Show passages'}
        </button>
      </div>
      {!cited.length && <p className="mt-1.5 text-[11px] text-muted">No passage was cited in this answer.</p>}
      {cards && (
        <div className="anim-fade mt-2.5 grid gap-2 sm:grid-cols-2">
          {ordered.map((s) => (
            <SourceCard key={s.n} source={s} cited={citedSet.has(s.n)} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function WebList({ sources }: { sources: WebSource[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {sources.slice(0, 8).map((s) => (
        <a
          key={s.uri}
          href={s.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="flex max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-muted transition hover:border-accent-500/50 hover:text-ink"
        >
          <ExternalLink size={10} className="shrink-0" />
          <span className="truncate">{s.title}</span>
        </a>
      ))}
    </div>
  );
}

const RERANK_LABEL = { none: 'no reranking', local: 'reranked locally', llm: 'reranked by LLM' } as const;

function TraceDetails({ trace, research }: { trace: RetrievalTrace; research: boolean }) {
  const searched = research
    ? plural(trace.query.split(' | ').length, 'search')
    : `Searched “${trace.query}”${trace.rewritten ? ' (your follow-up, rewritten)' : ''}`;
  return (
    <div className="anim-fade mt-2.5 space-y-1.5 rounded-lg bg-canvas px-3 py-2 text-[11px] leading-relaxed text-muted ring-1 ring-line">
      <div className="break-words">
        {searched} · {trace.candidates} candidates · {RERANK_LABEL[trace.reranker]}
        {trace.dropped ? ` · ${trace.dropped} weak ${trace.dropped === 1 ? 'match' : 'matches'} left out` : ''} · {trace.ms} ms
      </div>
      {trace.warning && (
        <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
          <TriangleAlert size={12} className="mt-px shrink-0" />
          {trace.warning}
        </div>
      )}
    </div>
  );
}

/** Where to get a key for each provider, for the inline setup prompt. */
const KEY_PAGES: Partial<Record<ChatProviderId, string>> = {
  gemini: 'https://aistudio.google.com/apikey',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
};

/** Shown instead of an error when no model is connected yet: paste a key here and the answer runs again. */
function SetupPrompt({ onOpenSettings, onRetry }: { onOpenSettings: () => void; onRetry?: () => void }) {
  const s = useSettings();
  const [key, setKey] = useState('');
  const provider = s.chat.provider;
  const label = CHAT_PRESETS[provider].label;
  const page = KEY_PAGES[provider];
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (provider === 'compatible' || !key.trim()) return;
    updateSettings((x) => ({ ...x, keys: { ...x.keys, [provider]: key.trim() } }));
    setKey('');
    onRetry?.();
  };
  return (
    <div className="mt-1 rounded-xl border border-line bg-canvas p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-500/15 text-accent-700 dark:text-accent-300">
          <KeyRound size={15} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-ink">Connect {label} to get answers</div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Your key stays in this browser and is only sent to {label}.
            {page && (
              <>
                {' '}
                <a
                  href={page}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent-700 underline underline-offset-2 dark:text-accent-300"
                >
                  Get a key
                </a>
              </>
            )}
          </p>
        </div>
      </div>
      {provider !== 'compatible' && (
        <form onSubmit={save} className="mt-3 flex flex-wrap gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={`Paste your ${label} API key`}
            aria-label={`${label} API key`}
            autoComplete="off"
            spellCheck={false}
            className={cn(inputClass, 'min-w-0 flex-1 basis-52 font-mono text-xs')}
          />
          <button type="submit" disabled={!key.trim()} className={primaryButtonClass}>
            {onRetry ? 'Save and answer' : 'Save'}
          </button>
        </form>
      )}
      <button type="button" onClick={onOpenSettings} className="mt-2 text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink">
        Use a different provider or model
      </button>
    </div>
  );
}

function ErrorBox({ error, onOpenSettings, onRetry }: { error: string; onOpenSettings: () => void; onRetry?: () => void }) {
  // A missing key is a setup step, not a failure.
  if (/^Add your .+ API key/.test(error)) return <SetupPrompt onOpenSettings={onOpenSettings} onRetry={onRetry} />;
  const setup = /Settings/.test(error);
  return (
    <div className="mt-1 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
      <div className="flex items-start gap-2">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <span className="break-words">{error}</span>
      </div>
      {(setup || onRetry) && (
        <div className="mt-2 flex gap-2 pl-6">
          {setup && (
            <button onClick={onOpenSettings} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">
              Open settings
            </button>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The time a message was sent, as the reader's clock shows it. */
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The labelled buttons under an answer. */
const actionClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-ink ring-1 ring-line transition hover:bg-raised';

function UserMessage({ message: m, canEdit, onEdit, onPin, onSavePrompt }: Props) {
  // The text being edited; null while the message is just shown.
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const text = draft?.trim();
    if (text && text !== m.content) onEdit(m, text);
    setDraft(null);
  };
  return (
    <div className="anim-rise group flex gap-3">
      <div
        aria-hidden="true"
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-raised text-[10px] font-bold text-ink ring-1 ring-line"
      >
        You
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[13px] font-bold text-ink">You</span>
          <span className="text-[11px] text-muted">{clock(m.createdAt)}</span>
          {m.mode === 'research' && <span className="text-[11px] font-semibold text-accent-700 dark:text-accent-300">Deep Research</span>}
          {m.pinned && <Pin size={11} className="text-accent-500" />}
        </div>
        {/* Image data stays on the device it was sent from; other devices just see the text. */}
        {m.images?.some((img) => img.data) ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {m.images
              .filter((img) => img.data)
              .map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name}
                  className="h-24 max-w-[200px] rounded-xl border border-line object-cover"
                />
              ))}
          </div>
        ) : null}
        {draft !== null ? (
          <form
            className="w-full max-w-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <textarea
              autoFocus
              value={draft}
              rows={Math.min(10, draft.split('\n').length + 1)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setDraft(null);
                else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
              }}
              aria-label="Edit message"
              className={cn(inputClass, 'resize-none rounded-xl text-[14.5px] leading-relaxed')}
            />
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <span className="mr-auto text-[11px] text-muted">Sending replaces everything after this message.</span>
              <button type="button" onClick={() => setDraft(null)} className={buttonClass}>
                Cancel
              </button>
              <button type="submit" disabled={!draft.trim()} className={primaryButtonClass}>
                Send
              </button>
            </div>
          </form>
        ) : m.content ? (
          <div className="inline-block max-w-full rounded-2xl rounded-tl-md bg-gray-200/80 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink dark:bg-raised">
            {m.content}
          </div>
        ) : null}
        <div className="mt-1 flex items-center gap-0.5 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {m.content && canEdit && draft === null && (
            <IconButton title="Edit and resend" onClick={() => setDraft(m.content)}>
              <Pencil size={13} />
            </IconButton>
          )}
          {m.content && (
            <IconButton title="Save to your prompts" onClick={() => onSavePrompt(m.content)}>
              <Bookmark size={13} />
            </IconButton>
          )}
          <IconButton title={m.pinned ? 'Unpin from context' : 'Pin as context for this chat'} onClick={() => onPin(m)} active={m.pinned}>
            {m.pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message: m, streaming, canRetry, onCite, onRetry, onPin, onToolDecision, onOpenSettings, docsInScope }: Props) {
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const sources = m.sources ?? [];
  const chart = useMemo(() => (streaming ? null : detectChartData(m.content)), [m.content, streaming]);
  const citeTitle = (n: number) => {
    const s = sources[n - 1];
    return s ? `${s.docName}${s.page ? ` · p. ${s.page}` : ''}` : '';
  };
  const copy = () => {
    void navigator.clipboard.writeText(m.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const waiting = streaming && !m.content && !m.error;
  // A retrieval trace means sources are in and the model is composing.
  const phase = m.trace ? 'writing' : docsInScope ? 'searching' : 'thinking';
  // What the answer is doing right now, in words; null once text is arriving and nothing waits.
  const waitingRun = m.toolRuns?.find((r) => r.status === 'approval');
  const runningRun = m.toolRuns?.find((r) => r.status === 'running');
  const status = !streaming
    ? null
    : waitingRun
      ? 'Waiting for you to allow a tool…'
      : runningRun
        ? `Running ${runningRun.tool} on ${runningRun.connector}…`
        : m.content
          ? null
          : m.trace
            ? sources.length
              ? `Reading ${plural(sources.length, 'passage')}…`
              : 'Writing the answer…'
            : docsInScope
              ? `Searching ${plural(docsInScope, 'document')}…`
              : 'Thinking…';

  return (
    <div className="anim-rise group flex gap-3">
      <Logo size="sm" className="mt-0.5 self-start" busy={streaming} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[13px] font-bold text-ink">CaptBot</span>
          <span className="truncate text-[11px] text-muted">{[m.model, clock(m.createdAt)].filter(Boolean).join(' · ')}</span>
          {m.pinned && <Pin size={11} className="shrink-0 text-accent-500" />}
        </div>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3.5 shadow-sm">
          {m.steps?.length ? <Steps steps={m.steps} done={!streaming} /> : null}
          {m.toolRuns?.length ? <ToolRuns runs={m.toolRuns} onDecide={onToolDecision} /> : null}
          {waiting && !m.steps?.length && !m.toolRuns?.length ? (
            <AnswerLoader phase={phase} label={status ?? undefined} />
          ) : (
            status && (
              <div
                role="status"
                aria-live="polite"
                className={cn('mb-2 flex items-center gap-2 text-xs font-medium', waitingRun ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}
              >
                {!waitingRun && <LoaderCircle size={13} className="animate-spin" />}
                {status}
              </div>
            )
          )}
          {m.content && (
            <Markdown
              content={m.content}
              sourceCount={sources.length}
              onCite={(n) => onCite(m, n)}
              citeTitle={citeTitle}
              citeSource={(n) => sources[n - 1]}
              streaming={streaming}
            />
          )}
          {m.aborted && <div className="mt-2 text-xs font-medium text-muted">Stopped</div>}
          {m.error && <ErrorBox error={m.error} onOpenSettings={onOpenSettings} onRetry={canRetry ? () => onRetry(m) : undefined} />}
          {chart && (
            <Suspense fallback={null}>
              <ChartBlock data={chart} />
            </Suspense>
          )}
          {sources.length > 0 && <SourceList sources={sources} content={m.content} streaming={streaming} onOpen={(n) => onCite(m, n)} />}
          {m.webSources?.length ? <WebList sources={m.webSources} /> : null}
          {!streaming && !m.error && (m.content || m.aborted) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
              <IconButton title={m.pinned ? 'Unpin from context' : 'Pin as context for this chat'} onClick={() => onPin(m)} active={m.pinned}>
                {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </IconButton>
              {m.trace && (
                <button
                  type="button"
                  onClick={() => setDetails((d) => !d)}
                  aria-expanded={details}
                  title={m.trace.warning ? 'How this answer was found (has a note)' : 'How this answer was found'}
                  className={cn(
                    'relative inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted transition hover:bg-canvas hover:text-ink',
                    details && 'bg-canvas text-ink',
                  )}
                >
                  <Info size={13} /> Details
                  {m.trace.warning && <span className="absolute top-1 left-[18px] h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Has a note" />}
                </button>
              )}
              <span className="flex-1" />
              {canRetry && (
                <button type="button" onClick={() => onRetry(m)} className={actionClass}>
                  <RotateCcw size={12} /> Regenerate
                </button>
              )}
              {m.content && (
                <button type="button" onClick={copy} className={actionClass}>
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          )}
          {details && m.trace && !streaming && <TraceDetails trace={m.trace} research={m.mode === 'research'} />}
        </div>
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem(props: Props) {
  return props.message.role === 'user' ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});
