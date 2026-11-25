import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUsage } from '../auth/usage';
import { rateLimitMessage, ServerChat, ServerEmbedder } from './server';
import { RateLimitError, SetupError } from './types';

const sse = (chunks: string[], headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } },
  );

afterEach(() => vi.unstubAllGlobals());

async function collect(gen: AsyncIterable<{ text?: string }>) {
  let out = '';
  for await (const d of gen) out += d.text ?? '';
  return out;
}

describe('ServerChat', () => {
  it('streams deltas and sends the session token, mapping utility calls to the fast tier', async () => {
    const fetchMock = vi.fn(async () =>
      sse(['data: {"text":"Hel"}\n\n', 'data: {"text":"lo"}\n\nevent: done\ndata: {}\n\n'], {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': '1',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const chat = new ServerChat(async () => 'tok');
    const text = await collect(chat.stream({ model: 'ignored', messages: [{ role: 'user', content: 'hi' }], effort: 'low' }));
    expect(text).toBe('Hello');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string).tier).toBe('fast');
  });

  it('turns a 429 into a non-retryable limit error that points to Settings', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'rate_limited', scope: 'chat', window: 'day', limit: 100, remaining: 0, reset: Date.now() + 3_600_000 }), {
          status: 429,
        }),
    );
    const chat = new ServerChat(async () => 'tok');
    const err = await collect(chat.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.message).toMatch(/today's free-tier allowance of 100 AI calls/);
    expect(err.message).toMatch(/Settings/);
  });

  it('asks the user to sign in again when there is no session token', async () => {
    const chat = new ServerChat(async () => null);
    await expect(collect(chat.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))).rejects.toBeInstanceOf(SetupError);
  });

  it('explains when the API is not running (dev server returns the app HTML)', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const chat = new ServerChat(async () => 'tok');
    await expect(collect(chat.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))).rejects.toThrow(/vercel dev/);
  });

  it('surfaces a server-side error event', async () => {
    vi.stubGlobal('fetch', async () => sse(['data: {"text":"par"}\n\nevent: error\ndata: {"message":"The AI provider request failed."}\n\n']));
    const chat = new ServerChat(async () => 'tok');
    await expect(collect(chat.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))).rejects.toThrow('The AI provider request failed.');
  });
});

describe('ServerEmbedder', () => {
  it('uses the same index key as the direct Gemini embedder and formats query prompts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ vectors: [[1, 0]] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const embedder = new ServerEmbedder(async () => 'tok', 'gemini-embedding-2', 768);
    expect(embedder.key).toBe('gemini:gemini-embedding-2:768');
    const v = await embedder.embedQuery('solar');
    expect(Array.from(v)).toEqual([1, 0]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: 'gemini-embedding-2', dimensions: 768, texts: ['task: search result | query: solar'] });
    expect(body.taskType).toBeUndefined();
  });
});

describe('rateLimitMessage', () => {
  it('explains per-minute limits in seconds', () => {
    expect(rateLimitMessage({ error: 'rate_limited', scope: 'embed', window: 'minute', limit: 60, remaining: 0, reset: 30_000 }, 0)).toBe(
      'The free tier allows 60 indexing requests a minute. Try again in 30 s, or add your own API key in Settings to skip the limit.',
    );
  });
});

// Keeps the usage hook import exercised so tree-shaking changes don't silently drop it.
void useUsage;
