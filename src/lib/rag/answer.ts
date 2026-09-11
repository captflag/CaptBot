import { scopedReadyDocIds, uid } from '../db';
import { createChatProvider, createEmbedder } from '../providers';
import { isAbort } from '../providers/http';
import { complete, type ChatProvider, type ChatTurn, type Embedder } from '../providers/types';
import { CONDENSE_SYSTEM, PLAN_SYSTEM, systemPrompt, userTurn } from '../prompts';
import { embeddingKeyOf, getSettings, type Settings } from '../settings';
import { isServerStorage } from '../sync/mode';
import { serverCandidates } from '../sync/serverSearch';
import type { ChatMessage, ImageAttachment, RerankMode, ResearchStep, RetrievalTrace, SourceRef, Thread, WebSource } from '../types';
import { stripCitations } from './citations';
import { errorText, parseJsonLoose } from './json';
import { buildSources, retrieve, selectDiverse, type CandidateSource, type RetrieveResult, type Retrieved } from './retrieve';

export type AnswerEvent =
  | { type: 'steps'; steps: ResearchStep[] }
  | { type: 'retrieval'; sources: SourceRef[]; trace: RetrievalTrace }
  | { type: 'text'; text: string }
  | { type: 'web'; webSources: WebSource[] };

export interface AnswerInput {
  thread: Pick<Thread, 'collectionIds'>;
  /** Earlier messages in the thread, oldest first. */
  history: ChatMessage[];
  question: string;
  images?: ImageAttachment[];
  mode: 'chat' | 'research';
  webSearch: boolean;
  signal: AbortSignal;
  /** Where to search; defaults to the account index with server storage, otherwise this browser's. */
  source?: CandidateSource;
}

interface Context {
  input: AnswerInput;
  settings: Settings;
  chat: ChatProvider;
  embedder: Embedder | null;
  docIds: Set<string>;
}

class StepTracker {
  private list: ResearchStep[] = [];
  start(label: string): ResearchStep {
    const step: ResearchStep = { id: uid(), label, status: 'running' };
    this.list.push(step);
    return step;
  }
  event(): AnswerEvent {
    return { type: 'steps', steps: this.list.map((s) => ({ ...s })) };
  }
}

function historyTurns(history: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = history
    .filter((m) => !m.error && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: (m.role === 'assistant' ? stripCitations(m.content) : m.content).slice(0, 6000) }));
  while (turns.length && turns[0].role === 'assistant') turns.shift();
  return turns;
}

/** Rewrites a follow-up ("what about the second one?") into a standalone search query. */
async function condenseQuery(ctx: Context): Promise<string> {
  const { input, settings, chat } = ctx;
  const convo = input.history
    .filter((m) => !m.error && m.content.trim())
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${stripCitations(m.content).slice(0, 600)}`)
    .join('\n');
  const out = await complete(chat, {
    model: settings.chat.fastModel,
    system: CONDENSE_SYSTEM,
    messages: [{ role: 'user', content: `<conversation>\n${convo}\n</conversation>\n\n<follow_up>${input.question}</follow_up>` }],
    effort: 'low',
    signal: input.signal,
  });
  const query = out.trim().split('\n')[0].replace(/^["'`]+|["'`]+$/g, '').trim();
  return query.length >= 2 && query.length <= 500 ? query : input.question;
}

function search(ctx: Context, query: string, topK?: number): Promise<RetrieveResult> {
  return retrieve({
    query,
    docIds: ctx.docIds,
    collectionIds: ctx.input.thread.collectionIds,
    embedder: ctx.embedder,
    embeddingKey: ctx.embedder?.key ?? embeddingKeyOf(ctx.settings),
    chat: ctx.chat,
    settings: ctx.settings,
    topK,
    signal: ctx.input.signal,
    source: ctx.input.source ?? (isServerStorage() ? serverCandidates : undefined),
  });
}

async function* chatRetrieval(ctx: Context): AsyncGenerator<AnswerEvent, SourceRef[]> {
  const { input, settings } = ctx;
  const started = performance.now();
  let query = input.question;
  if (settings.retrieval.rewriteQueries && input.history.some((m) => m.role === 'user')) {
    try {
      query = await condenseQuery(ctx);
    } catch (err) {
      if (isAbort(err)) throw err;
    }
  }
  const res = await search(ctx, query);
  const sources = buildSources(res.results, settings.retrieval.contextTokens);
  yield {
    type: 'retrieval',
    sources,
    trace: {
      query,
      rewritten: query !== input.question,
      candidates: res.candidates,
      reranker: res.reranker,
      dropped: res.dropped || undefined,
      ms: Math.round(performance.now() - started),
      warning: res.warnings.join(' ') || undefined,
    },
  };
  return sources;
}

function interleave(lists: Retrieved[][]): Retrieved[] {
  const out: Retrieved[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const r = list[i];
      if (r && !seen.has(r.chunk.id)) {
        seen.add(r.chunk.id);
        out.push(r);
      }
    }
  }
  return out;
}

type Settled<T> = { index: number; ok: true; value: T } | { index: number; ok: false; error: unknown };

/** Yields each promise's outcome as soon as it settles, in completion order. */
async function* asCompleted<T>(promises: Promise<T>[]): AsyncGenerator<Settled<T>> {
  const queue: Settled<T>[] = [];
  let wake: (() => void) | null = null;
  promises.forEach((p, index) => {
    p.then(
      (value) => queue.push({ index, ok: true, value }),
      (error: unknown) => queue.push({ index, ok: false, error }),
    ).finally(() => wake?.());
  });
  for (let done = 0; done < promises.length; done++) {
    while (!queue.length) await new Promise<void>((resolve) => (wake = resolve));
    yield queue.shift()!;
  }
}

/** Deep Research: plan sub-queries, search them all at once, pool the evidence. */
async function* researchRetrieval(ctx: Context, steps: StepTracker): AsyncGenerator<AnswerEvent, { sources: SourceRef[]; queries: string[] }> {
  const { input, settings, chat } = ctx;
  const started = performance.now();

  const plan = steps.start('Planning the research');
  yield steps.event();
  let queries = [input.question];
  try {
    const raw = await complete(chat, {
      model: settings.chat.fastModel,
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: input.question }],
      json: true,
      effort: 'low',
      signal: input.signal,
    });
    const parsed = parseJsonLoose<{ queries?: unknown }>(raw);
    const planned = Array.isArray(parsed?.queries)
      ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim()).slice(0, 5)
      : [];
    if (planned.length) queries = planned;
    plan.status = 'done';
    plan.detail = planned.length ? `${queries.length} search queries` : 'Searching with the original question';
  } catch (err) {
    if (isAbort(err)) throw err;
    plan.status = 'error';
    plan.detail = `Planner failed (${errorText(err)}); searching with the original question`;
  }
  yield steps.event();

  const topK = Math.max(4, Math.round(settings.retrieval.topK * 0.75));
  const searches = queries.map((query) => ({ query, step: steps.start(`Searching: ${query}`) }));
  yield steps.event();

  const perQuery: Retrieved[][] = queries.map(() => []);
  const warnings = new Set<string>();
  let candidates = 0;
  let dropped = 0;
  let reranker: RerankMode = settings.retrieval.rerank;
  // The sub-questions are searched in parallel; each step updates as its own search finishes.
  for await (const outcome of asCompleted(searches.map((s) => search(ctx, s.query, topK)))) {
    const step = searches[outcome.index].step;
    if (outcome.ok) {
      const res = outcome.value;
      perQuery[outcome.index] = res.results;
      candidates += res.candidates;
      dropped += res.dropped;
      reranker = res.reranker;
      res.warnings.forEach((w) => warnings.add(w));
      step.status = 'done';
      step.detail = res.results.length
        ? `${res.results.length} passages from ${new Set(res.results.map((r) => r.doc.id)).size} documents`
        : 'Nothing relevant found';
    } else {
      if (isAbort(outcome.error)) throw outcome.error;
      step.status = 'error';
      step.detail = errorText(outcome.error);
    }
    yield steps.event();
  }

  const pooled = selectDiverse(interleave(perQuery), settings.retrieval.topK * 2);
  const sources = buildSources(pooled, settings.retrieval.contextTokens * 2);
  yield {
    type: 'retrieval',
    sources,
    trace: {
      query: queries.join(' | '),
      rewritten: queries.length > 1,
      candidates,
      reranker,
      dropped: dropped || undefined,
      ms: Math.round(performance.now() - started),
      warning: [...warnings].join(' ') || undefined,
    },
  };
  return { sources, queries };
}

/**
 * Answers one user message: retrieves from the thread's knowledge scope
 * (with Deep Research planning when requested), then streams a cited answer.
 */
export async function* answer(input: AnswerInput): AsyncGenerator<AnswerEvent> {
  const settings = getSettings();
  const chat = createChatProvider(settings);
  let embedder: Embedder | null = null;
  try {
    embedder = createEmbedder(settings);
  } catch {
    // Retrieval degrades to keyword-only; retrieve() reports it in the trace.
  }
  // An image-only message has nothing to search for.
  const docIds = input.question.trim() ? await scopedReadyDocIds(input.thread.collectionIds) : new Set<string>();
  const ctx: Context = { input, settings, chat, embedder, docIds };
  const research = input.mode === 'research';
  const webSearch = input.webSearch && chat.supportsWebSearch;
  const steps = new StepTracker();

  let sources: SourceRef[] = [];
  let extra: string | undefined;
  if (research) {
    if (ctx.docIds.size) {
      const result = yield* researchRetrieval(ctx, steps);
      sources = result.sources;
      if (result.queries.length > 1) extra = `Sub-questions investigated:\n${result.queries.map((q) => `- ${q}`).join('\n')}`;
    } else {
      const step = steps.start(webSearch ? 'No documents in scope, researching with web search' : 'No documents in scope, using model knowledge');
      step.status = 'done';
      yield steps.event();
    }
  } else if (ctx.docIds.size) {
    sources = yield* chatRetrieval(ctx);
  }

  const system = systemPrompt({
    displayName: settings.displayName,
    research,
    hasSources: sources.length > 0,
    searchedKnowledge: ctx.docIds.size > 0,
    webSearch,
    pinned: input.history.filter((m) => m.pinned).map((m) => `${m.role === 'user' ? 'User' : 'CaptBot'}: ${stripCitations(m.content).slice(0, 2000)}`),
  });
  const messages: ChatTurn[] = [
    ...historyTurns(input.history),
    { role: 'user', content: userTurn(input.question, sources, extra), images: input.images },
  ];

  const writing = research ? steps.start('Writing the report') : null;
  if (writing) yield steps.event();
  for await (const delta of chat.stream({
    model: settings.chat.model,
    system,
    messages,
    webSearch,
    effort: research ? 'deep' : 'normal',
    signal: input.signal,
  })) {
    if (delta.text) yield { type: 'text', text: delta.text };
    if (delta.webSources) yield { type: 'web', webSources: delta.webSources };
  }
  if (writing) {
    writing.status = 'done';
    yield steps.event();
  }
}
