import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { LimitScope } from './contract.js';
import type { LimitConfig, Limiter } from './limits.js';

type Env = Record<string, string | undefined>;

/** Either the Upstash console pair or the Vercel Marketplace (KV_*) pair. */
export function hasUpstash(env: Env): boolean {
  return Boolean((env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) || (env.KV_REST_API_URL && env.KV_REST_API_TOKEN));
}

/** Shared, durable limits across every function instance. */
export function upstashLimiter(cfg: LimitConfig): Limiter {
  const redis = Redis.fromEnv();
  const make = (scope: LimitScope) => ({
    // Sliding window smooths bursts; the daily window resets at 00:00 UTC.
    minute: new Ratelimit({ redis, prefix: `captbot:${scope}:minute`, limiter: Ratelimit.slidingWindow(cfg[scope].perMinute, '1 m') }),
    day: new Ratelimit({ redis, prefix: `captbot:${scope}:day`, limiter: Ratelimit.fixedWindow(cfg[scope].perDay, '1 d') }),
  });
  const limits = { chat: make('chat'), embed: make('embed'), search: make('search'), write: make('write') };

  return {
    async consume(userId, scope) {
      const minute = await limits[scope].minute.limit(userId);
      if (!minute.success) return { ok: false, window: 'minute', limit: minute.limit, remaining: 0, reset: minute.reset };
      const day = await limits[scope].day.limit(userId);
      return { ok: day.success, window: 'day', limit: day.limit, remaining: day.remaining, reset: day.reset };
    },
    async peek(userId, scope) {
      const { remaining, reset, limit } = await limits[scope].day.getRemaining(userId);
      return { limit: limit ?? cfg[scope].perDay, remaining, reset };
    },
  };
}
