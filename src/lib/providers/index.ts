import { getAuthToken, serverTierAvailable } from '../auth/session';
import { CHAT_PRESETS, EMBEDDING_PRESETS, type Settings } from '../settings';
import type { ChatProviderId } from '../types';
import { LocalEmbedder } from './local';
import { OPENAI_BASE_URL, OpenAIChat, OpenAIEmbedder } from './openai';
import { ServerChat, ServerEmbedder } from './server';
import { SetupError, type ChatDelta, type ChatProvider, type ChatRequest, type EmbedInput, type Embedder } from './types';

export { SetupError };

/** Lets tests swap in deterministic providers. */
export const providerOverrides: {
  chat?: ChatProvider;
  embedder?: Embedder;
  /** Stands in for the local cross-encoder: one relevance probability (0..1) per passage. */
  reranker?: (query: string, passages: string[]) => Promise<number[]>;
} = {};

/** Loads a vendor SDK on the first request so it stays out of the initial bundle. */
class LazyChat implements ChatProvider {
  private instance: Promise<ChatProvider> | null = null;
  constructor(
    readonly id: ChatProviderId,
    readonly supportsWebSearch: boolean,
    private readonly load: () => Promise<ChatProvider>,
  ) {}
  /** Both SDK-backed providers (Gemini and Claude) can call functions. */
  readonly supportsTools = true;
  async *stream(req: ChatRequest): AsyncGenerator<ChatDelta> {
    this.instance ??= this.load();
    yield* (await this.instance).stream(req);
  }
}

class LazyEmbedder implements Embedder {
  private instance: Promise<Embedder> | null = null;
  constructor(
    readonly key: string,
    readonly batchSize: number,
    private readonly load: () => Promise<Embedder>,
  ) {}
  private get() {
    return (this.instance ??= this.load());
  }
  async embedDocuments(docs: EmbedInput[], signal?: AbortSignal) {
    return (await this.get()).embedDocuments(docs, signal);
  }
  async embedQuery(query: string, signal?: AbortSignal) {
    return (await this.get()).embedQuery(query, signal);
  }
}

function requireKey(key: string, label: string, purpose: string): string {
  if (!key.trim()) throw new SetupError(`Add your ${label} API key in Settings to ${purpose}.`);
  return key.trim();
}

/**
 * A user's own key always wins (direct from the browser, no limits). Without one,
 * signed-in users fall back to the free tier: the server's key, rate limited per user.
 */
export function createChatProvider(s: Settings): ChatProvider {
  if (providerOverrides.chat) return providerOverrides.chat;
  const provider = s.chat.provider;
  if (provider === 'compatible') return new OpenAIChat('compatible', s.keys.compatible, s.compatibleBaseUrl);
  const key = s.keys[provider].trim();
  if (!key) {
    if (serverTierAvailable()) return new ServerChat(getAuthToken);
    throw new SetupError(`Add your ${CHAT_PRESETS[provider].label} API key in Settings to chat.`);
  }
  switch (provider) {
    case 'gemini':
      return new LazyChat('gemini', true, async () => new (await import('./gemini')).GeminiChat(key));
    case 'anthropic':
      return new LazyChat('anthropic', false, async () => new (await import('./anthropic')).AnthropicChat(key));
    case 'openai':
      return new OpenAIChat('openai', key, OPENAI_BASE_URL);
  }
}

export function createEmbedder(s: Settings): Embedder {
  if (providerOverrides.embedder) return providerOverrides.embedder;
  const { provider, model, dimensions } = s.embeddings;
  const purpose = 'index documents (or switch embeddings to Local)';
  switch (provider) {
    case 'gemini': {
      const key = s.keys.gemini.trim();
      if (!key) {
        if (serverTierAvailable()) return new ServerEmbedder(getAuthToken, model, dimensions);
        throw new SetupError(`Add your Gemini API key in Settings to ${purpose}.`);
      }
      // key and batch size mirror GeminiEmbedder's own
      return new LazyEmbedder(`gemini:${model}:${dimensions}`, 100, async () => new (await import('./gemini')).GeminiEmbedder(key, model, dimensions));
    }
    case 'openai':
      return new OpenAIEmbedder('openai', requireKey(s.keys.openai, 'OpenAI', purpose), OPENAI_BASE_URL, model, dimensions);
    case 'compatible':
      return new OpenAIEmbedder('compatible', s.keys.compatible, s.compatibleBaseUrl, model, dimensions);
    case 'local':
      return new LocalEmbedder(model, EMBEDDING_PRESETS.local.dimensions);
  }
}
