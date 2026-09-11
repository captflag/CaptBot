import { ProviderError, RateLimitError } from './types';

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as Error)?.name === 'AbortError';
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const backoff = (attempt: number) => Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

/** Retries rate limits and transient server errors with jittered exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      const status = statusOf(err);
      const transient = status === undefined ? /RESOURCE_EXHAUSTED|UNAVAILABLE|fetch failed/i.test(String(err)) : RETRYABLE.has(status);
      if (isAbort(err) || !transient || attempt >= retries) throw err;
      await sleep(backoff(attempt), signal);
    }
  }
}

async function errorMessage(res: Response, provider: string): Promise<string> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      detail = json?.error?.message ?? json?.message ?? json?.error ?? body;
    } catch {
      detail = body;
    }
  } catch {
    // ignore unreadable bodies
  }
  if (res.status === 401 || res.status === 403) return `${provider} rejected the API key (${res.status}). Check it in Settings.`;
  return `${provider} error ${res.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`;
}

export async function fetchWithRetry(url: string, init: RequestInit, provider: string, retries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (isAbort(err)) throw err;
      if (attempt >= retries) {
        throw new ProviderError(
          `Could not reach ${provider} at ${new URL(url).origin}. Check the URL, your connection, or the server's CORS settings.`,
          undefined,
          provider,
        );
      }
      await sleep(backoff(attempt), init.signal ?? undefined);
      continue;
    }
    if (res.ok) return res;
    if (RETRYABLE.has(res.status) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt), init.signal ?? undefined);
      continue;
    }
    throw new ProviderError(await errorMessage(res, provider), res.status, provider);
  }
}
