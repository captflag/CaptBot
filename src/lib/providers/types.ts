import type { ChatProviderId, ImageAttachment, WebSource } from '../types';

/** Parses a tool call's JSON arguments; anything that is not a JSON object becomes no arguments. */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
  /** On assistant turns: the tools the model asked to call. */
  toolCalls?: ToolCall[];
  /** On user turns: what those tools returned, answering the previous assistant turn's calls. */
  toolResults?: ToolResult[];
}

/** A function the model may call. Names must match ^[a-zA-Z0-9_-]{1,64}$ for every provider. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments (an object schema). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini's thought signature for this call, which must be sent back with it. */
  signature?: string;
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  isError?: boolean;
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
  /** Functions the model may call; it answers with toolCalls instead of (or as well as) text. */
  tools?: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatDelta {
  text?: string;
  webSources?: WebSource[];
  /** Sent once, at the end of a reply that asks for tools to be run. */
  toolCalls?: ToolCall[];
}

export interface ChatProvider {
  readonly id: ChatProviderId;
  readonly supportsWebSearch: boolean;
  /** Can call functions (connector tools). Absent means no. */
  readonly supportsTools?: boolean;
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
