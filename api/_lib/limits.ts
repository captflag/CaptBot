import type { LimitScope, LimitState } from './contract.js';

export interface LimitDecision extends LimitState {
  ok: boolean;
  window: 'minute' | 'day';
}

/** Per-user allowance for calls made on the server's key. */
export interface Limiter {
  /** Counts one request against the per-minute and per-day windows. */
  consume(userId: string, scope: LimitScope): Promise<LimitDecision>;
  /** Today's allowance without counting a request. */
  peek(userId: string, scope: LimitScope): Promise<LimitState>;
}

export type LimitConfig = Record<LimitScope, { perMinute: number; perDay: number }>;

/** Limits come from env so they can be tuned on Vercel without a deploy of new code. */
export function readLimitConfig(env: Record<string, string | undefined>): LimitConfig {
  const n = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
  };
  return {
    chat: { perMinute: n('FREE_CHAT_PER_MINUTE', 10), perDay: n('FREE_CHAT_PER_DAY', 100) },
    // One embed request is a batch of up to 100 chunks (64 when indexing into server storage).
    embed: { perMinute: n('FREE_EMBED_PER_MINUTE', 60), perDay: n('FREE_EMBED_PER_DAY', 300) },
    // Each knowledge-base search embeds the question on the server's key.
    search: { perMinute: n('FREE_SEARCH_PER_MINUTE', 60), perDay: n('FREE_SEARCH_PER_DAY', 1000) },
    // Saves to server storage: sync pushes (up to 150 changes each), new documents and text parts.
    write: { perMinute: n('FREE_WRITE_PER_MINUTE', 120), perDay: n('FREE_WRITE_PER_DAY', 5000) },
  };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Fixed-window counters in process memory. Only for local development and tests:
 * serverless instances don't share memory, so this can't enforce anything in production.
 */
export function memoryLimiter(cfg: LimitConfig, now: () => number = Date.now): Limiter {
  const windows = new Map<string, { used: number; reset: number }>();
  const hit = (key: string, limit: number, size: number, count: boolean) => {
    const t = now();
    let w = windows.get(key);
    if (!w || t >= w.reset) {
      // Aligned windows: daily allowances reset at 00:00 UTC.
      w = { used: 0, reset: Math.floor(t / size) * size + size };
      windows.set(key, w);
    }
    const ok = w.used < limit;
    if (ok && count) w.used++;
    return { ok, limit, remaining: Math.max(0, limit - w.used), reset: w.reset };
  };
  return {
    async consume(userId, scope) {
      const { perMinute, perDay } = cfg[scope];
      const minute = hit(`${scope}:minute:${userId}`, perMinute, MINUTE, true);
      if (!minute.ok) return { ...minute, window: 'minute' };
      return { ...hit(`${scope}:day:${userId}`, perDay, DAY, true), window: 'day' };
    },
    async peek(userId, scope) {
      const { limit, remaining, reset } = hit(`${scope}:day:${userId}`, cfg[scope].perDay, DAY, false);
      return { limit, remaining, reset };
    },
  };
}
