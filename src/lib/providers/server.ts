import type { ChatBody, EmbedBody, EmbedResponse, LimitScope, RateLimitedBody } from '../../../api/_lib/contract';
import { recordUsage } from '../auth/usage';
import { geminiDocTexts, geminiQueryText, usesPromptStyle } from './geminiFormat';
import { isAbort } from './http';
import { readSSE } from './sse';
import { ProviderError, RateLimitError, SetupError, type ChatDelta, type ChatProvider, type ChatRequest, type EmbedInput, type Embedder } from './types';

type TokenGetter = () => Promise<string | null>;

const LABEL = 'CaptBot free tier';
const SESSION_EXPIRED = 'Your session has expired. Sign in again, or add your own API key in Settings.';

/** Vite's dev server answers unknown paths with index.html; say what's wrong instead of failing oddly. */
const apiMissing = () =>
  new ProviderError('The CaptBot API is not running here. Start the app with `vercel dev` (or deploy it) to use the free tier.', undefined, LABEL);

export function rateLimitMessage(info: RateLimitedBody, now = Date.now()): string {
  const what = { chat: 'AI calls', embed: 'indexing requests', search: 'knowledge-base searches', write: 'saves to your account' }[info.scope];
  const seconds = Math.max(1, Math.ceil((info.reset - now) / 1000));
  if (info.window === 'minute') {
    return `The free tier allows ${info.limit} ${what} a minute. Try again in ${seconds} s, or add your own API key in Settings to skip the limit.`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  const wait = hours ? `${hours} h ${minutes} min` : `${minutes} min`;
  return `You've used today's free-tier allowance of ${info.limit} ${what}. It resets in ${wait}. Add your own API key in Settings to keep going.`;
}

async function post(path: string, body: unknown, getToken: TokenGetter, signal?: AbortSignal): Promise<Response> {
  const token = await getToken();
  if (!token) throw new SetupError(SESSION_EXPIRED);
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ProviderError('Could not reach the CaptBot server. Check your connection.', undefined, LABEL);
  }
}

async function failure(res: Response): Promise<Error> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error page
  }
  if (res.status === 429 && (body as RateLimitedBody | null)?.error === 'rate_limited') {
    return new RateLimitError(rateLimitMessage(body as RateLimitedBody), LABEL);
  }
  if (res.status === 401) return new SetupError(SESSION_EXPIRED);
  const detail = (body as { error?: unknown } | null)?.error;
  return new ProviderError(`${LABEL}: ${typeof detail === 'string' ? detail : `server error ${res.status}`}`, res.status, LABEL);
}

/** Chat through /api/chat on the server's key; the server picks the model for each tier. */
export class ServerChat implements ChatProvider {
  readonly id = 'gemini' as const;
  readonly supportsWebSearch = true;

  constructor(private readonly getToken: TokenGetter) {}

  async *stream(req: ChatRequest): AsyncGenerator<ChatDelta> {
    const body: ChatBody = {
      // Utility calls (rewrites, planning, reranking) run at low effort on the fast model.
      tier: req.effort === 'low' ? 'fast' : 'main',
      system: req.system,
      messages: req.messages,
      json: req.json,
      webSearch: req.webSearch,
      effort: req.effort,
      maxTokens: req.maxTokens,
    };
    const res = await post('/api/chat', body, this.getToken, req.signal);
    recordUsage('chat', res.headers);
    if (!res.ok) throw await failure(res);
    if (!res.headers.get('content-type')?.includes('text/event-stream')) throw apiMissing();
    for await (const evt of readSSE(res, req.signal)) {
      if (evt.event === 'done') return;
      const data = JSON.parse(evt.data) as ChatDelta & { message?: string };
      if (evt.event === 'error') throw new ProviderError(data.message ?? 'The free-tier request failed.', undefined, LABEL);
      yield { text: data.text, webSources: data.webSources };
    }
  }
}

/** Gemini embeddings through /api/embed. Same key as the direct Gemini embedder, so indexes carry over. */
export class ServerEmbedder implements Embedder {
  readonly key: string;
  readonly batchSize = 100;

  constructor(
    private readonly getToken: TokenGetter,
    private readonly model: string,
    private readonly dimensions: number,
  ) {
    this.key = `gemini:${model}:${dimensions}`;
  }

  embedDocuments(docs: EmbedInput[], signal?: AbortSignal) {
    return this.call(geminiDocTexts(this.model, docs), 'RETRIEVAL_DOCUMENT', signal);
  }

  async embedQuery(query: string, signal?: AbortSignal) {
    const [vector] = await this.call([geminiQueryText(this.model, query)], 'RETRIEVAL_QUERY', signal);
    return vector;
  }

  private async call(texts: string[], taskType: NonNullable<EmbedBody['taskType']>, signal?: AbortSignal): Promise<Float32Array[]> {
    const body: EmbedBody = {
      model: this.model,
      dimensions: this.dimensions,
      texts,
      taskType: usesPromptStyle(this.model) ? undefined : taskType,
    };
    const res = await post('/api/embed', body, this.getToken, signal);
    recordUsage('embed' satisfies LimitScope, res.headers);
    if (!res.ok) throw await failure(res);
    if (!res.headers.get('content-type')?.includes('application/json')) throw apiMissing();
    const json = (await res.json()) as EmbedResponse;
    if (json.vectors?.length !== texts.length) {
      throw new ProviderError(`${LABEL} returned ${json.vectors?.length ?? 0} embeddings for ${texts.length} inputs.`, undefined, LABEL);
    }
    return json.vectors.map((v) => Float32Array.from(v));
  }
}
