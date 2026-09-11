import {
  Bookmark,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  Pin,
  PinOff,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { extractCitations } from '../lib/rag/citations';
import type { ChatMessage, ResearchStep, RetrievalTrace, SourceRef, WebSource } from '../lib/types';
import { cn, plural } from '../lib/utils';
import { AnswerLoader } from './AnswerLoader';
import { Logo } from './Logo';
import { Markdown } from './Markdown';
import { IconButton } from './ui';

const ChartBlock = lazy(() => import('./ChartBlock'));

interface Props {
  message: ChatMessage;
  streaming: boolean;
  canRetry: boolean;
  onCite: (message: ChatMessage, n: number) => void;
  onRetry: (message: ChatMessage) => void;
  onPin: (message: ChatMessage) => void;
  onSavePrompt: (text: string) => void;
  onOpenSettings: () => void;
  /** The chat has documents to search, so an answer starts with retrieval. */
  knowledgeInScope: boolean;
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

function StepIcon({ status }: { status: ResearchStep['status'] }) {
  if (status === 'running') return <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin text-violet-500" />;
  if (status === 'error') return <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />;
  return <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />;
}

function Steps({ steps, done }: { steps: ResearchStep[]; done: boolean }) {
  const [open, setOpen] = useState(() => !done);
  const expanded = !done || open;
  return (
    <div className="mb-3 rounded-xl border border-violet-100 bg-violet-50/50 dark:border-violet-900/40 dark:bg-violet-950/20">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!done}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-violet-700 dark:text-violet-300"
      >
        <BrainCircuit size={14} className={cn(!done && 'animate-pulse')} />
        Deep Research
        <span className="ml-auto font-normal text-violet-500/80">{done ? plural(steps.length, 'step') : 'working…'}</span>
        {done && <ChevronDown size={14} className={cn('transition', expanded && 'rotate-180')} />}
      </button>
      {expanded && (
        <ol className="space-y-1.5 px-3 pb-3">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-xs">
              <StepIcon status={s.status} />
              <span className="min-w-0">
                <span className="text-gray-700 dark:text-gray-300">{s.label}</span>
                {s.detail && <span className="block text-gray-500">{s.detail}</span>}
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
        'flex w-full items-start gap-2.5 rounded-xl border bg-white p-2.5 text-left transition hover:border-violet-300 hover:shadow-sm dark:bg-white/5 dark:hover:border-violet-800',
        cited ? 'border-gray-200 dark:border-gray-800' : 'border-dashed border-gray-200 opacity-80 dark:border-gray-800',
      )}
    >
      <span className="cite-chip mt-0.5 shrink-0">{source.n}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{source.docName}</span>
        {meta && <span className="block truncate text-[11px] text-gray-500">{meta}</span>}
        <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{source.text}</span>
      </span>
    </button>
  );
}

function SourceList({ sources, content, streaming, onOpen }: { sources: SourceRef[]; content: string; streaming: boolean; onOpen: (n: number) => void }) {
  const [showAll, setShowAll] = useState(false);
  const cited = useMemo(() => extractCitations(content, sources.length), [content, sources.length]);
  if (streaming) {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
        <FileText size={12} /> Reading {plural(sources.length, 'passage')} from your documents
      </div>
    );
  }
  const citedSet = new Set(cited);
  const primary = cited.map((n) => sources[n - 1]);
  const rest = sources.filter((s) => !citedSet.has(s.n));
  const shown = showAll ? [...primary, ...rest] : primary;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-gray-500 uppercase">
        Sources
        {!cited.length && <span className="font-normal tracking-normal text-gray-400 normal-case">none cited in this answer</span>}
      </div>
      {shown.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.map((s) => (
            <SourceCard key={s.n} source={s} cited={citedSet.has(s.n)} onOpen={onOpen} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-gray-500 hover:text-violet-600">
          {showAll ? 'Hide' : 'Show'} {plural(rest.length, 'other retrieved passage')}
        </button>
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
          className="flex max-w-[220px] items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 transition hover:border-sky-300 hover:text-sky-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400"
        >
          <ExternalLink size={10} className="shrink-0" />
          <span className="truncate">{s.title}</span>
        </a>
      ))}
    </div>
  );
}

const RERANK_LABEL = { none: 'no reranking', local: 'reranked locally', llm: 'reranked by LLM' } as const;

function TraceLine({ trace, research }: { trace: RetrievalTrace; research: boolean }) {
  const searched = research
    ? plural(trace.query.split(' | ').length, 'search')
    : `searched “${trace.query}”${trace.rewritten ? ' (rewritten follow-up)' : ''}`;
  return (
    <div className="mt-3 space-y-1 text-[11px] text-gray-400 dark:text-gray-500">
      <div className="truncate" title={trace.query}>
        {searched} · {trace.candidates} candidates · {RERANK_LABEL[trace.reranker]}
        {trace.dropped ? ` · ${trace.dropped} weak ${trace.dropped === 1 ? 'match' : 'matches'} left out` : ''} · {trace.ms} ms
      </div>
      {trace.warning && (
        <div className="flex items-start gap-1 text-amber-600 dark:text-amber-500">
          <TriangleAlert size={12} className="mt-px shrink-0" />
          {trace.warning}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ error, onOpenSettings, onRetry }: { error: string; onOpenSettings: () => void; onRetry?: () => void }) {
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
            <button onClick={onRetry} className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40">
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UserMessage({ message: m, onPin, onSavePrompt }: Props) {
  return (
    <div className="group flex flex-col items-end">
      {/* Image data stays on the device it was sent from; other devices just see the text. */}
      {m.images?.some((img) => img.data) ? (
        <div className="mb-2 flex flex-wrap justify-end gap-2">
          {m.images.filter((img) => img.data).map((img, i) => (
            <img
              key={i}
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={img.name}
              className="h-24 max-w-[200px] rounded-lg border border-gray-200 object-cover dark:border-gray-800"
            />
          ))}
        </div>
      ) : null}
      {m.content && (
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-gray-200 bg-white px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-gray-800 shadow-sm dark:border-gray-800 dark:bg-white/5 dark:text-gray-200">
          {m.content}
        </div>
      )}
      <div className="mt-1 flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100">
        {m.mode === 'research' && <span className="mr-1 text-[10px] font-medium text-violet-500">Deep Research</span>}
        {m.content && (
          <IconButton title="Save to Library" onClick={() => onSavePrompt(m.content)}>
            <Bookmark size={13} />
          </IconButton>
        )}
        <IconButton title={m.pinned ? 'Unpin from context' : 'Pin as context for this chat'} onClick={() => onPin(m)} active={m.pinned}>
          {m.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </IconButton>
      </div>
    </div>
  );
}

function AssistantMessage({ message: m, streaming, canRetry, onCite, onRetry, onPin, onOpenSettings, knowledgeInScope }: Props) {
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
  const phase = m.trace ? 'writing' : knowledgeInScope ? 'searching' : 'thinking';

  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
        <Logo size="sm" showText={false} className="scale-75" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">CaptBot</span>
          {m.pinned && <Pin size={11} className="text-violet-500" />}
        </div>
        {m.steps?.length ? <Steps steps={m.steps} done={!streaming} /> : null}
        {waiting && !m.steps?.length && <AnswerLoader phase={phase} />}
        {m.content && (
          <Markdown content={m.content} sourceCount={sources.length} onCite={(n) => onCite(m, n)} citeTitle={citeTitle} />
        )}
        {m.aborted && <div className="mt-2 text-xs font-medium text-gray-400">Stopped</div>}
        {m.error && <ErrorBox error={m.error} onOpenSettings={onOpenSettings} onRetry={canRetry ? () => onRetry(m) : undefined} />}
        {chart && (
          <Suspense fallback={null}>
            <ChartBlock data={chart} />
          </Suspense>
        )}
        {sources.length > 0 && <SourceList sources={sources} content={m.content} streaming={streaming} onOpen={(n) => onCite(m, n)} />}
        {m.webSources?.length ? <WebList sources={m.webSources} /> : null}
        {m.trace && !streaming && <TraceLine trace={m.trace} research={m.mode === 'research'} />}
        {!streaming && !m.error && (m.content || m.aborted) && (
          <div className="mt-2 flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100">
            {m.content && (
              <IconButton title={copied ? 'Copied' : 'Copy'} onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            )}
            {canRetry && (
              <IconButton title="Regenerate" onClick={() => onRetry(m)}>
                <RotateCcw size={14} />
              </IconButton>
            )}
            <IconButton title={m.pinned ? 'Unpin from context' : 'Pin as context for this chat'} onClick={() => onPin(m)} active={m.pinned}>
              {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem(props: Props) {
  return props.message.role === 'user' ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});
