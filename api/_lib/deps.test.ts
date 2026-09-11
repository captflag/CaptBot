// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildDeps } from './deps.js';
import { createChatHandler } from './handlers.js';

describe('buildDeps', () => {
  it('fails closed in production when Upstash is missing', async () => {
    const deps = buildDeps({ VERCEL_ENV: 'production', CLERK_SECRET_KEY: 'sk_test_x', GEMINI_API_KEY: 'k' });
    await expect(deps.limiter.consume('user_1', 'chat')).rejects.toMatchObject({ status: 503 });
  });

  it('uses in-memory limits outside production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = buildDeps({ VERCEL_ENV: 'preview', FREE_CHAT_PER_DAY: '7' });
    const decision = await deps.limiter.consume('user_1', 'chat');
    expect(decision).toMatchObject({ ok: true, limit: 7, remaining: 6 });
    warn.mockRestore();
  });

  it('rejects every request with 503 when Clerk is not configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = createChatHandler(buildDeps({ GEMINI_API_KEY: 'k' }));
    const res = await handler(new Request('http://localhost/api/chat', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Sign-in is not configured on the server.' });
    warn.mockRestore();
  });
});
