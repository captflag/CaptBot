import type { ChatDelta, ChatProvider, ChatRequest, ChatTurn, EmbedInput, Embedder, ToolCall } from './types';
import { parseArgs, ProviderError } from './types';
import { fetchWithRetry } from './http';
import { readSSE } from './sse';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

type Flavor = 'openai' | 'compatible';

function headers(apiKey: string): HeadersInit {
  // Ollama and most local servers ignore the key but some proxies require the header.
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey || 'none'}` };
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** One app turn as Chat Completions messages: tool results become one "tool" message each. */
function toMessages(m: ChatTurn): Record<string, unknown>[] {
  if (m.toolResults?.length) {
    return m.toolResults.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.output}` : r.output }));
  }
  if (m.toolCalls?.length) {
    return [
      {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      },
    ];
  }
  return [
    {
      role: m.role,
      content: m.images?.length
        ? [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })),
          ]
        : m.content,
    },
  ];
}

interface StreamChunk {
  error?: { message?: string };
  choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
}

/** Chat Completions over fetch; also serves OpenAI-compatible servers. */
export class OpenAIChat implements ChatProvider {
  readonly supportsWebSearch = false;
  readonly supportsTools = true;
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
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages.flatMap(toMessages)];
    const body: Record<string, unknown> = { model: req.model, messages, stream: true };
    if (req.json) body.response_format = { type: 'json_object' };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
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
    // Tool calls stream in pieces (name first, then the arguments a few characters at a time), keyed by index.
    const calls: { id: string; name: string; args: string }[] = [];
    for await (const evt of readSSE(res, req.signal)) {
      if (evt.data === '[DONE]') break;
      let json: StreamChunk;
      try {
        json = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (json.error) throw new ProviderError(json.error.message ?? 'Stream error', undefined, this.label);
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) yield { text: delta.content };
      for (const part of delta?.tool_calls ?? []) {
        const call = (calls[part.index] ??= { id: '', name: '', args: '' });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.args += part.function.arguments;
      }
    }
    const toolCalls: ToolCall[] = calls
      .filter((c) => c && c.name)
      .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.args) }));
    if (toolCalls.length) yield { toolCalls };
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
