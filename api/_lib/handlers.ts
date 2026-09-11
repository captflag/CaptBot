import type {
  ChatBody,
  ChatDeltaBody,
  ChatTurnBody,
  EmbedBody,
  LimitScope,
  LimitState,
  RateLimitedBody,
  UsageBody,
} from './contract.js';
import type { DataStore } from './datastore.js';
import type { LimitDecision, Limiter } from './limits.js';

/** An error whose message is safe to show to the caller. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatBackend {
  stream(body: ChatBody, signal: AbortSignal): AsyncIterable<ChatDeltaBody>;
}

export interface EmbedBackend {
  embed(body: EmbedBody, signal: AbortSignal): Promise<number[][]>;
}

export interface ApiDeps {
  /** Returns the signed-in user's id, or null when the request has no valid session. */
  authenticate(req: Request): Promise<string | null>;
  limiter: Limiter;
  chat: ChatBackend;
  embed: EmbedBackend;
  /** The account knowledge base in Postgres; null when no database is configured. */
  store: DataStore | null;
}

const MAX_CHAT_BYTES = 12_000_000; // room for a few images
const MAX_EMBED_BYTES = 2_500_000;
const MAX_MESSAGES = 60;
const MAX_TEXT_CHARS = 400_000;
const MAX_IMAGES = 6;
const MAX_EMBED_TEXTS = 100;
const MAX_EMBED_TEXT_CHARS = 20_000;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function limitHeaders(s: LimitState): Record<string, string> {
  return {
    'x-ratelimit-limit': String(s.limit),
    'x-ratelimit-remaining': String(s.remaining),
    'x-ratelimit-reset': String(s.reset),
  };
}

export function rateLimited(scope: LimitScope, d: LimitDecision): Response {
  const body: RateLimitedBody = { error: 'rate_limited', scope, window: d.window, limit: d.limit, remaining: 0, reset: d.reset };
  const retryAfter = Math.max(1, Math.ceil((d.reset - Date.now()) / 1000));
  return json(429, body, { ...limitHeaders({ ...d, remaining: 0 }), 'retry-after': String(retryAfter) });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json(err.status, { error: err.message });
  console.error(err);
  return json(500, { error: 'Something went wrong on the server.' });
}

/** Provider errors can carry request details; only pass through a short, generic description. */
function publicMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  const status = (err as { status?: unknown })?.status;
  console.error(err);
  return typeof status === 'number' ? `The AI provider returned an error (${status}).` : 'The AI provider request failed.';
}

export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, 'Request is too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseChatBody(raw: unknown): ChatBody {
  if (!isObject(raw)) throw new HttpError(400, 'Expected a JSON object.');
  const { tier, system, messages, json: wantsJson, webSearch, effort, maxTokens } = raw;
  if (tier !== 'main' && tier !== 'fast') throw new HttpError(400, 'tier must be "main" or "fast".');
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) {
    throw new HttpError(400, `messages must be a non-empty array of at most ${MAX_MESSAGES}.`);
  }
  let chars = typeof system === 'string' ? system.length : 0;
  let images = 0;
  const turns: ChatTurnBody[] = messages.map((m) => {
    if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new HttpError(400, 'Each message needs a role ("user" or "assistant") and string content.');
    }
    chars += m.content.length;
    const turn: ChatTurnBody = { role: m.role, content: m.content };
    if (m.images !== undefined) {
      if (!Array.isArray(m.images)) throw new HttpError(400, 'images must be an array.');
      turn.images = m.images.map((img) => {
        if (!isObject(img) || typeof img.mimeType !== 'string' || !img.mimeType.startsWith('image/') || typeof img.data !== 'string') {
          throw new HttpError(400, 'Each image needs an image/* mimeType and base64 data.');
        }
        images++;
        return { name: typeof img.name === 'string' ? img.name : 'image', mimeType: img.mimeType, data: img.data };
      });
    }
    return turn;
  });
  if (chars > MAX_TEXT_CHARS) throw new HttpError(413, 'The conversation is too long for the free tier.');
  if (images > MAX_IMAGES) throw new HttpError(400, `At most ${MAX_IMAGES} images per request.`);
  if (system !== undefined && typeof system !== 'string') throw new HttpError(400, 'system must be a string.');
  if (effort !== undefined && effort !== 'low' && effort !== 'normal' && effort !== 'deep') {
    throw new HttpError(400, 'effort must be "low", "normal" or "deep".');
  }
  return {
    tier,
    system: system as string | undefined,
    messages: turns,
    json: wantsJson === true,
    webSearch: webSearch === true,
    effort: effort as ChatBody['effort'],
    maxTokens: typeof maxTokens === 'number' && maxTokens > 0 ? Math.min(Math.floor(maxTokens), 16_384) : undefined,
  };
}

export function parseEmbedBody(raw: unknown): EmbedBody {
  if (!isObject(raw)) throw new HttpError(400, 'Expected a JSON object.');
  const { model, dimensions, texts, taskType } = raw;
  if (typeof model !== 'string' || !model) throw new HttpError(400, 'model is required.');
  if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions < 0 || dimensions > 3072) {
    throw new HttpError(400, 'dimensions must be an integer from 0 to 3072.');
  }
  if (!Array.isArray(texts) || !texts.length || texts.length > MAX_EMBED_TEXTS) {
    throw new HttpError(400, `texts must be a non-empty array of at most ${MAX_EMBED_TEXTS}.`);
  }
  if (!texts.every((t) => typeof t === 'string' && t.length <= MAX_EMBED_TEXT_CHARS)) {
    throw new HttpError(400, `Each text must be a string of at most ${MAX_EMBED_TEXT_CHARS} characters.`);
  }
  if (taskType !== undefined && taskType !== 'RETRIEVAL_DOCUMENT' && taskType !== 'RETRIEVAL_QUERY') {
    throw new HttpError(400, 'Unsupported taskType.');
  }
  return { model, dimensions, texts: texts as string[], taskType: taskType as EmbedBody['taskType'] };
}

export async function requireUser(req: Request, deps: ApiDeps): Promise<string> {
  const userId = await deps.authenticate(req);
  if (!userId) throw new HttpError(401, 'Sign in to use the CaptBot free tier.');
  return userId;
}

/** POST /api/chat: streams a model reply as SSE, counted against the user's allowance. */
export function createChatHandler(deps: ApiDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' }, { allow: 'POST' });
    try {
      const userId = await requireUser(req, deps);
      const body = parseChatBody(await readJson(req, MAX_CHAT_BYTES));
      const decision = await deps.limiter.consume(userId, 'chat');
      if (!decision.ok) return rateLimited('chat', decision);

      const upstream = new AbortController();
      req.signal?.addEventListener('abort', () => upstream.abort(), { once: true });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string | null, data: unknown) =>
            controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`));
          try {
            for await (const delta of deps.chat.stream(body, upstream.signal)) send(null, delta);
            send('done', {});
          } catch (err) {
            if (!upstream.signal.aborted) send('error', { message: publicMessage(err) });
          } finally {
            controller.close();
          }
        },
        cancel() {
          upstream.abort();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
          ...limitHeaders(decision),
        },
      });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** POST /api/embed: embeds one batch of chunk texts on the server's key. */
export function createEmbedHandler(deps: ApiDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' }, { allow: 'POST' });
    try {
      const userId = await requireUser(req, deps);
      const body = parseEmbedBody(await readJson(req, MAX_EMBED_BYTES));
      const decision = await deps.limiter.consume(userId, 'embed');
      if (!decision.ok) return rateLimited('embed', decision);
      const vectors = await deps.embed.embed(body, req.signal ?? new AbortController().signal);
      return json(200, { vectors }, limitHeaders(decision));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** GET /api/usage: today's remaining free-tier allowance, without counting a request. */
export function createUsageHandler(deps: ApiDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET') return json(405, { error: 'Use GET.' }, { allow: 'GET' });
    try {
      const userId = await requireUser(req, deps);
      const [chat, embed] = await Promise.all([deps.limiter.peek(userId, 'chat'), deps.limiter.peek(userId, 'embed')]);
      const body: UsageBody = { chat, embed };
      return json(200, body);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
