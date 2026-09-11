// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChatBody, RateLimitedBody, UsageBody } from './contract.js';
import { createChatHandler, createEmbedHandler, createUsageHandler, type ApiDeps, type ChatBackend } from './handlers.js';
import { memoryLimiter } from './limits.js';

const limits = {
  chat: { perMinute: 2, perDay: 3 },
  embed: { perMinute: 5, perDay: 5 },
  search: { perMinute: 5, perDay: 5 },
  write: { perMinute: 5, perDay: 5 },
};

function deps(overrides: Partial<ApiDeps> = {}): ApiDeps & { seen: ChatBody[] } {
  const seen: ChatBody[] = [];
  const chat: ChatBackend = {
    async *stream(body) {
      seen.push(body);
      yield { text: 'Hello ' };
      yield { text: 'world', webSources: [{ title: 'x', uri: 'https://x.test' }] };
    },
  };
  return {
    seen,
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? 'user_1' : null),
    limiter: memoryLimiter(limits),
    chat,
    embed: { embed: async (body) => body.texts.map(() => [0.1, 0.2]) },
    store: null,
    ...overrides,
  };
}

const chatRequest = (body: unknown, token = 'good') =>
  new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const validChat = { tier: 'main', messages: [{ role: 'user', content: 'Hi' }] };

describe('POST /api/chat', () => {
  it('rejects requests without a valid session', async () => {
    const res = await createChatHandler(deps())(chatRequest(validChat, 'bad'));
    expect(res.status).toBe(401);
  });

  it('validates the body before spending any allowance', async () => {
    const d = deps();
    const res = await createChatHandler(d)(chatRequest({ tier: 'huge', messages: [] }));
    expect(res.status).toBe(400);
    expect((await d.limiter.peek('user_1', 'chat')).remaining).toBe(3);
  });

  it('streams the reply as SSE with rate-limit headers', async () => {
    const d = deps();
    const res = await createChatHandler(d)(chatRequest({ ...validChat, effort: 'low', maxTokens: 999_999 }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-ratelimit-limit')).toBe('3');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('2');
    const text = await res.text();
    expect(text).toContain('data: {"text":"Hello "}');
    expect(text).toContain('"webSources":[{"title":"x","uri":"https://x.test"}]');
    expect(text.trim().endsWith('event: done\ndata: {}')).toBe(true);
    expect(d.seen[0].maxTokens).toBe(16_384);
  });

  it('returns 429 with retry-after once the per-minute burst is used up', async () => {
    const handler = createChatHandler(deps());
    await handler(chatRequest(validChat));
    await handler(chatRequest(validChat));
    const res = await handler(chatRequest(validChat));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await res.json()) as RateLimitedBody;
    expect(body).toMatchObject({ error: 'rate_limited', scope: 'chat', window: 'minute', limit: 2, remaining: 0 });
  });

  it('enforces the daily allowance across minutes', async () => {
    let now = Date.UTC(2026, 8, 11, 10, 0, 0);
    const handler = createChatHandler(deps({ limiter: memoryLimiter(limits, () => now) }));
    for (let i = 0; i < 3; i++) {
      expect((await handler(chatRequest(validChat))).status).toBe(200);
      now += 61_000;
    }
    const res = await handler(chatRequest(validChat));
    expect(res.status).toBe(429);
    const body = (await res.json()) as RateLimitedBody;
    expect(body.window).toBe('day');
    expect(body.reset).toBe(Date.UTC(2026, 8, 12)); // next 00:00 UTC
  });

  it('reports provider failures mid-stream as an error event without leaking details', async () => {
    const failing: ChatBackend = {
      async *stream() {
        yield { text: 'partial' };
        throw Object.assign(new Error('secret upstream detail key=abc'), { status: 503 });
      },
    };
    const res = await createChatHandler(deps({ chat: failing }))(chatRequest(validChat));
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('The AI provider returned an error (503).');
    expect(text).not.toContain('secret');
  });
});

describe('POST /api/embed', () => {
  const embedRequest = (body: unknown) =>
    new Request('http://localhost/api/embed', { method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify(body) });

  it('returns one vector per text', async () => {
    const res = await createEmbedHandler(deps())(embedRequest({ model: 'gemini-embedding-2', dimensions: 768, texts: ['a', 'b'] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ vectors: [[0.1, 0.2], [0.1, 0.2]] });
  });

  it('rejects oversized batches', async () => {
    const res = await createEmbedHandler(deps())(embedRequest({ model: 'm', dimensions: 768, texts: new Array(101).fill('x') }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/usage', () => {
  it("reports today's remaining allowance without spending it", async () => {
    const d = deps();
    await createChatHandler(d)(chatRequest(validChat));
    const usage = createUsageHandler(d);
    const req = () => new Request('http://localhost/api/usage', { headers: { authorization: 'Bearer good' } });
    const first = (await (await usage(req())).json()) as UsageBody;
    const second = (await (await usage(req())).json()) as UsageBody;
    expect(first.chat).toMatchObject({ limit: 3, remaining: 2 });
    expect(second.chat.remaining).toBe(2);
    expect(first.embed.remaining).toBe(5);
  });
});
