import type { ChatDelta, ChatProvider, ChatRequest, EmbedInput, Embedder } from './types';
import { ProviderError } from './types';
import { fetchWithRetry } from './http';
import { readSSE } from './sse';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

type Flavor = 'openai' | 'compatible';

function headers(apiKey: string): HeadersInit {
  // Ollama and most local servers ignore the key but some proxies require the header.
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey || 'none'}` };
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Chat Completions over fetch; also serves OpenAI-compatible servers. */
export class OpenAIChat implements ChatProvider {
  readonly supportsWebSearch = false;
  private readonly label: string;

  constructor(
    readonly id: Flavor,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {
    this.label = id === 'openai' ? 'OpenAI' : 'The compatible server';
  }

  async *stream(req: ChatRequest): AsyncGenerator<ChatDelta> {
    const official = this.id === 'openai';
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) => ({
        role: m.role,
        content: m.images?.length
          ? [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })),
            ]
          : m.content,
      })),
    ];
    const body: Record<string, unknown> = { model: req.model, messages, stream: true };
    if (req.json) body.response_format = { type: 'json_object' };
    if (official) {
      if (req.maxTokens) body.max_completion_tokens = req.maxTokens;
      if (/^(gpt-[5-9]|o\d)/.test(req.model) && req.effort && req.effort !== 'normal') {
        body.reasoning_effort = req.effort === 'low' ? 'low' : 'high';
      }
    } else if (req.maxTokens) {
      body.max_tokens = req.maxTokens;
    }

    const res = await fetchWithRetry(
      `${trimSlash(this.baseUrl)}/chat/completions`,
      { method: 'POST', headers: headers(this.apiKey), body: JSON.stringify(body), signal: req.signal },
      this.label,
    );
    for await (const evt of readSSE(res, req.signal)) {
      if (evt.data === '[DONE]') return;
      let json: { error?: { message?: string }; choices?: { delta?: { content?: string | null } }[] };
      try {
        json = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (json.error) throw new ProviderError(json.error.message ?? 'Stream error', undefined, this.label);
      const text = json.choices?.[0]?.delta?.content;
      if (text) yield { text };
    }
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly key: string;
  readonly batchSize = 96;
  private readonly label: string;

  constructor(
    flavor: Flavor,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly dimensions: number,
  ) {
    this.key = `${flavor}:${model}:${dimensions}`;
    this.label = flavor === 'openai' ? 'OpenAI' : 'The compatible server';
  }

  embedDocuments(docs: EmbedInput[], signal?: AbortSignal) {
    return this.call(
      docs.map((d) => `${d.title}\n\n${d.text}`),
      signal,
    );
  }

  async embedQuery(query: string, signal?: AbortSignal) {
    const [vector] = await this.call([query], signal);
    return vector;
  }

  private async call(input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const body: Record<string, unknown> = { model: this.model, input };
    if (this.dimensions) body.dimensions = this.dimensions;
    const res = await fetchWithRetry(
      `${trimSlash(this.baseUrl)}/embeddings`,
      { method: 'POST', headers: headers(this.apiKey), body: JSON.stringify(body), signal },
      this.label,
    );
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const data = (json.data ?? []).sort((a, b) => a.index - b.index);
    if (data.length !== input.length) {
      throw new ProviderError(`${this.label} returned ${data.length} embeddings for ${input.length} inputs.`, undefined, this.label);
    }
    return data.map((d) => Float32Array.from(d.embedding));
  }
}
