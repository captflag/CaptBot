import type { ChatProviderId, ImageAttachment, WebSource } from '../types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
}

/** Provider-neutral reasoning depth; each provider maps it to its own knob. */
export type Effort = 'low' | 'normal' | 'deep';

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatTurn[];
  effort?: Effort;
  /** Ask for a single JSON value as the whole reply. */
  json?: boolean;
  webSearch?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatDelta {
  text?: string;
  webSources?: WebSource[];
}

export interface ChatProvider {
  readonly id: ChatProviderId;
  readonly supportsWebSearch: boolean;
  stream(req: ChatRequest): AsyncIterable<ChatDelta>;
}

export interface EmbedInput {
  /** Contextual header: document name and heading path. */
  title: string;
  text: string;
}

export interface Embedder {
  /** provider:model:dimensions — must match embeddingKeyOf(settings). */
  readonly key: string;
  readonly batchSize: number;
  embedDocuments(docs: EmbedInput[], signal?: AbortSignal): Promise<Float32Array[]>;
  embedQuery(query: string, signal?: AbortSignal): Promise<Float32Array>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Thrown when a provider can't be used yet (e.g. no API key); shown to the user as a setup hint. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

/** A free-tier allowance is used up. Never retried automatically: retrying can't succeed until it resets. */
export class RateLimitError extends ProviderError {
  constructor(message: string, provider?: string) {
    super(message, 429, provider);
    this.name = 'RateLimitError';
  }
}

/** Runs a streaming request to completion and returns the text. */
export async function complete(provider: ChatProvider, req: ChatRequest): Promise<string> {
  let out = '';
  for await (const delta of provider.stream(req)) out += delta.text ?? '';
  return out;
}
