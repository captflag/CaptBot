import { clerkAuthenticator } from './auth.js';
import { geminiBackends, readGeminiConfig } from './gemini.js';
import { HttpError, type ApiDeps, type ChatBackend, type EmbedBackend } from './handlers.js';
import { memoryLimiter, readLimitConfig, type Limiter } from './limits.js';
import { pgStore } from './pg.js';
import { hasUpstash, upstashLimiter } from './upstash.js';

type Env = Record<string, string | undefined>;

const unavailable = (message: string) => () => {
  throw new HttpError(503, message);
};

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * Wires the API from environment variables. Anything missing fails closed with a 503:
 * the free tier never runs without sign-in, a provider key, or (in production) shared limits,
 * and server storage stays off without a database.
 */
export function buildDeps(env: Env): ApiDeps {
  const authenticate = clerkAuthenticator(env);
  const gemini = readGeminiConfig(env);
  const limits = readLimitConfig(env);

  let limiter: Limiter;
  if (hasUpstash(env)) {
    limiter = upstashLimiter(limits);
  } else if (env.VERCEL_ENV !== 'production') {
    console.warn('Upstash is not configured: using in-memory rate limits (fine for local dev, not for production).');
    limiter = memoryLimiter(limits);
  } else {
    const fail = unavailable('Rate limiting is not configured on the server, so the free tier is off.');
    limiter = { consume: async () => fail(), peek: async () => fail() };
  }

  let chat: ChatBackend;
  let embed: EmbedBackend;
  if (gemini) {
    ({ chat, embed } = geminiBackends(gemini));
  } else {
    const fail = unavailable('The free tier is not configured on the server.');
    chat = {
      // Fails on the first read of the stream.
      // eslint-disable-next-line require-yield -- it never yields: the first read throws.
      async *stream() {
        fail();
      },
    };
    embed = { embed: async () => fail() };
  }

  // Supabase's transaction pooler URL (port 6543). The client connects lazily, on the first query.
  const databaseUrl = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();

  return {
    authenticate: authenticate ?? (async () => unavailable('Sign-in is not configured on the server.')()),
    limiter,
    chat,
    embed,
    store: databaseUrl ? pgStore(databaseUrl, { maxChars: positive(env.STORAGE_MAX_CHARS, 100_000_000) }) : null,
  };
}

let cached: ApiDeps | null = null;

/** Built once per function instance. */
export function getDeps(): ApiDeps {
  cached ??= buildDeps(process.env);
  return cached;
}
