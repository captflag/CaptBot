import { scopedReadyDocIds, uid } from '../db';
import { createChatProvider, createEmbedder } from '../providers';
import { isAbort } from '../providers/http';
import { loadToolbox, runTool, type Toolbox } from '../mcp';
import { complete, type ChatProvider, type ChatTurn, type Embedder, type ToolCall, type ToolResult } from '../providers/types';
import { CONDENSE_SYSTEM, GAP_SYSTEM, PLAN_SYSTEM, sourcesBlock, systemPrompt, userTurn } from '../prompts';
import { embeddingKeyOf, getSettings, updateSettings, type Settings } from '../settings';
import { isServerStorage } from '../sync/mode';
import { serverCandidates } from '../sync/serverSearch';
import type { ChatMessage, ImageAttachment, RerankMode, ResearchStep, RetrievalTrace, SourceRef, Thread, ToolRun, WebSource } from '../types';
import { stripCitations } from './citations';
import { errorText, parseJsonLoose } from './json';
import { buildSources, retrieve, selectDiverse, type CandidateSource, type RetrieveResult, type Retrieved } from './retrieve';

export type AnswerEvent =
  | { type: 'steps'; steps: ResearchStep[] }
  | { type: 'retrieval'; sources: SourceRef[]; trace: RetrievalTrace }
  | { type: 'text'; text: string }
  | { type: 'web'; webSources: WebSource[] }
  | { type: 'tools'; runs: ToolRun[] };

/** The user's answer when a tool asks to run: this once, every time from now on, or not at all. */
export type ToolDecision = 'once' | 'always' | 'deny';

/** Rounds of tool calls one answer may make before the model has to answer with what it has. */
export const MAX_TOOL_ROUNDS = 8;

export interface AnswerInput {
  thread: Pick<Thread, 'collectionIds'>;
  /** Earlier messages in the thread, oldest first. */
  history: ChatMessage[];
  question: string;
  images?: ImageAttachment[];
  mode: 'chat' | 'research';
  webSearch: boolean;
  /** Let the model call tools from the enabled connectors. */
  tools?: boolean;
  /** Asks the user whether a tool may run. Without it, tools that are not always allowed are declined. */
  approve?: (run: ToolRun) => Promise<ToolDecision>;
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
  const query = out
    .trim()
    .split('\n')[0]
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
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

/** The search queries in a planner's JSON reply, {"queries": [...]}; none when the reply isn't one. */
function parseQueries(raw: string, max: number): string[] {
  const parsed = parseJsonLoose<{ queries?: unknown }>(raw);
  if (!Array.isArray(parsed?.queries)) return [];
  return parsed.queries
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, max);
}

/**
 * Deep Research: plan sub-queries, search them all at once, then check the evidence for gaps
 * and search once more for what is missing. Everything found is pooled.
 */
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
    const planned = parseQueries(raw, 5);
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
  const perQuery: Retrieved[][] = [];
  const warnings = new Set<string>();
  let candidates = 0;
  let dropped = 0;
  let reranker: RerankMode = settings.retrieval.rerank;
  // A round's queries are searched in parallel; each step updates as its own search finishes.
  async function* searchAll(round: string[]): AsyncGenerator<AnswerEvent> {
    const first = perQuery.length;
    const searches = round.map((query) => ({ query, step: steps.start(`Searching: ${query}`) }));
    round.forEach(() => perQuery.push([]));
    yield steps.event();
    for await (const outcome of asCompleted(searches.map((s) => search(ctx, s.query, topK)))) {
      const step = searches[outcome.index].step;
      if (outcome.ok) {
        const res = outcome.value;
        perQuery[first + outcome.index] = res.results;
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
  }
  const pool = () => selectDiverse(interleave(perQuery), settings.retrieval.topK * 2);
  yield* searchAll(queries);

  // One follow-up round: the fast model reads what was found and names what is still missing.
  let followUps: string[] = [];
  if (perQuery.some((r) => r.length)) {
    const gaps = steps.start('Checking the evidence for gaps');
    yield steps.event();
    try {
      const found = sourcesBlock(buildSources(pool(), settings.retrieval.contextTokens));
      const raw = await complete(chat, {
        model: settings.chat.fastModel,
        system: GAP_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${found}\n\n<searches>\n${queries.map((q) => `- ${q}`).join('\n')}\n</searches>\n\n<question>\n${input.question}\n</question>`,
          },
        ],
        json: true,
        effort: 'low',
        signal: input.signal,
      });
      const run = new Set(queries.map((q) => q.toLowerCase()));
      followUps = parseQueries(raw, 3).filter((q) => !run.has(q.toLowerCase()));
      gaps.status = 'done';
      gaps.detail = followUps.length ? `${followUps.length} follow-up ${followUps.length === 1 ? 'search' : 'searches'}` : 'The evidence covers the question';
    } catch (err) {
      if (isAbort(err)) throw err;
      gaps.status = 'error';
      gaps.detail = `Gap check failed (${errorText(err)}); writing from the first round`;
    }
    yield steps.event();
  }
  if (followUps.length) {
    queries = [...queries, ...followUps];
    yield* searchAll(followUps);
  }

  const pooled = pool();
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

const short = (s: string, max = 1500) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Rejects as soon as the signal aborts, so pressing Stop also ends a wait for the user's decision. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Remembers that a connector's tool may run without asking. */
function allowAlways(connectorId: string, tool: string) {
  updateSettings((s) => ({
    ...s,
    connectors: s.connectors.map((c) => (c.id === connectorId && !c.alwaysAllow.includes(tool) ? { ...c, alwaysAllow: [...c.alwaysAllow, tool] } : c)),
  }));
}

/**
 * Runs one tool call the model asked for, asking the user first unless that tool is always allowed.
 * Every outcome, refusals and failures included, goes back to the model as a result.
 */
async function* runCall(call: ToolCall, toolbox: Toolbox, runs: ToolRun[], input: AnswerInput, overLimit: boolean): AsyncGenerator<AnswerEvent, ToolResult> {
  const route = toolbox.route.get(call.name);
  const run: ToolRun = {
    id: uid(),
    connector: route?.connector.name ?? 'Unknown',
    tool: route?.tool ?? call.name,
    args: short(JSON.stringify(call.args)),
    status: 'running',
  };
  runs.push(run);
  const event = (): AnswerEvent => ({ type: 'tools', runs: runs.map((r) => ({ ...r })) });
  const result = (output: string, isError = false): ToolResult => ({ id: call.id, name: call.name, output, isError });
  const stop = (status: ToolRun['status'], note: string) => {
    run.status = status;
    run.output = note;
  };

  if (!route) {
    stop('error', 'The model asked for a tool that does not exist.');
    yield event();
    return result(`There is no tool named ${call.name}.`, true);
  }
  if (overLimit) {
    stop('denied', `Not run: an answer may make ${MAX_TOOL_ROUNDS} rounds of tool calls.`);
    yield event();
    return result('Not run: the limit of tool calls for this answer was reached. Answer with the information you already have.', true);
  }

  // Read the latest settings: "Always allow" pressed earlier in this answer counts already.
  const allowed = getSettings()
    .connectors.find((c) => c.id === route.connector.id)
    ?.alwaysAllow.includes(route.tool);
  if (!allowed) {
    run.status = 'approval';
    yield event();
    const decision = input.approve ? await untilAborted(input.approve({ ...run }), input.signal) : 'deny';
    if (decision === 'deny') {
      stop('denied', 'You declined this call.');
      yield event();
      return result('The user declined to run this tool. Carry on without it.', true);
    }
    if (decision === 'always') allowAlways(route.connector.id, route.tool);
    run.status = 'running';
  }
  yield event();

  try {
    const out = await runTool(route.connector, route.tool, call.args, input.signal);
    stop(out.isError ? 'error' : 'done', short(out.text));
    yield event();
    return result(out.text, out.isError);
  } catch (err) {
    if (isAbort(err)) throw err;
    stop('error', errorText(err));
    yield event();
    return result(`The tool call failed: ${errorText(err)}`, true);
  }
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

  // Connector tools: only when the user asked for them and the model can call functions.
  const connectors = input.tools && chat.supportsTools ? settings.connectors.filter((c) => c.enabled && c.url.trim()) : [];
  // ponytail: Gemini gets no connector tools while web search is on, because not every Gemini model
  // accepts Google Search and function calling in one request. Allow both once the models in use do.
  const toolbox = connectors.length && !(webSearch && chat.id === 'gemini') ? await loadToolbox(connectors, input.signal) : null;
  const runs: ToolRun[] = (toolbox?.failures ?? []).map((f) => ({ id: uid(), connector: f.connector, tool: '', status: 'error', output: f.error }));
  if (runs.length) yield { type: 'tools', runs: runs.map((r) => ({ ...r })) };
  const tools = toolbox?.specs.length ? toolbox.specs : undefined;

  const system = systemPrompt({
    displayName: settings.displayName,
    research,
    hasSources: sources.length > 0,
    searchedKnowledge: ctx.docIds.size > 0,
    webSearch,
    pinned: input.history.filter((m) => m.pinned).map((m) => `${m.role === 'user' ? 'User' : 'CaptBot'}: ${stripCitations(m.content).slice(0, 2000)}`),
    connectors: tools ? [...new Set([...toolbox!.route.values()].map((r) => r.connector.name))] : [],
  });
  const messages: ChatTurn[] = [...historyTurns(input.history), { role: 'user', content: userTurn(input.question, sources, extra), images: input.images }];

  const writing = research ? steps.start('Writing the report') : null;
  if (writing) yield steps.event();
  // Each round streams the model's reply; when it asks for tools, they run and the results go back
  // for another round. Without tools this is a single round, exactly as before.
  let wrote = false;
  for (let round = 0; ; round++) {
    const calls: ToolCall[] = [];
    let said = '';
    for await (const delta of chat.stream({
      model: settings.chat.model,
      system,
      messages,
      webSearch,
      tools,
      effort: research ? 'deep' : 'normal',
      signal: input.signal,
    })) {
      if (delta.text) {
        // Text from separate rounds ("Let me check…", then the answer) reads as separate paragraphs.
        if (!said && wrote) yield { type: 'text', text: '\n\n' };
        said += delta.text;
        yield { type: 'text', text: delta.text };
      }
      if (delta.webSources) yield { type: 'web', webSources: delta.webSources };
      if (delta.toolCalls) calls.push(...delta.toolCalls);
    }
    if (said) wrote = true;
    if (!calls.length || !toolbox || round > MAX_TOOL_ROUNDS) break;
    messages.push({ role: 'assistant', content: said, toolCalls: calls });
    const results: ToolResult[] = [];
    for (const call of calls) results.push(yield* runCall(call, toolbox, runs, input, round >= MAX_TOOL_ROUNDS));
    messages.push({ role: 'user', content: '', toolResults: results });
  }
  if (writing) {
    writing.status = 'done';
    yield steps.event();
  }
}
