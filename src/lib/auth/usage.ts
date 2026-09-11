import { useSyncExternalStore } from 'react';
import type { LimitScope, LimitState, UsageBody } from '../../../api/_lib/contract';

type Usage = Partial<Record<LimitScope, LimitState>>;

let usage: Usage = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Updates the free-tier meter from the rate-limit headers the API sends with every response. */
export function recordUsage(scope: LimitScope, headers: Headers) {
  if (!headers.has('x-ratelimit-limit')) return;
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (![limit, remaining, reset].every(Number.isFinite)) return;
  usage = { ...usage, [scope]: { limit, remaining, reset } };
  emit();
}

export async function refreshUsage(getToken: () => Promise<string | null>): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const res = await fetch('/api/usage', { headers: { authorization: `Bearer ${token}` } });
  // Vite's dev server answers unknown paths with index.html when the API isn't running.
  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return;
  const body = (await res.json()) as UsageBody;
  usage = { chat: body.chat, embed: body.embed };
  emit();
}

export function resetUsage() {
  usage = {};
  emit();
}

export function useUsage(): Usage {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => usage,
  );
}
