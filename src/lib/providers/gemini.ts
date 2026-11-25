import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part, type ThinkingConfig } from '@google/genai';
import type { ChatDelta, ChatProvider, ChatRequest, ChatTurn, EmbedInput, Effort, Embedder, ToolCall } from './types';
import { ProviderError } from './types';
import { geminiDocTexts, geminiQueryText, usesPromptStyle } from './geminiFormat';
import { withRetry } from './http';

function thinkingFor(model: string, effort: Effort = 'normal'): ThinkingConfig | undefined {
  if (effort === 'normal') return undefined;
  const pro = /pro/.test(model);
  if (/gemini-3/.test(model)) {
    // Pro models do not accept MINIMAL, so LOW is as far down as they go.
    if (effort === 'low') return { thinkingLevel: pro ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL };
    return { thinkingLevel: ThinkingLevel.HIGH };
  }
  if (/gemini-2\.5/.test(model)) {
    if (effort === 'low') return { thinkingBudget: pro ? 128 : 0 };
    return { thinkingBudget: -1 };
  }
  return undefined;
}

function toParts(m: ChatTurn): Part[] {
  if (m.toolResults?.length) {
    return m.toolResults.map((r) => ({ functionResponse: { id: r.id, name: r.name, response: r.isError ? { error: r.output } : { output: r.output } } }));
  }
  return [
    ...(m.images ?? []).map((img): Part => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
    // Empty text parts are rejected (e.g. an image-only question).
    ...(m.content ? [{ text: m.content }] : []),
    // Gemini 3 rejects a function call sent back without the thought signature it came with.
    ...(m.toolCalls ?? []).map((c): Part => ({ functionCall: { id: c.id, name: c.name, args: c.args }, thoughtSignature: c.signature })),
  ];
}

export class GeminiChat implements ChatProvider {
  readonly id = 'gemini' as const;
  readonly supportsWebSearch = true;
  readonly supportsTools = true;
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async *stream(req: ChatRequest): AsyncGenerator<ChatDelta> {
    const contents: Content[] = req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(m) }));
    const functions = req.tools?.length
      ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]
      : [];
    const config: GenerateContentConfig = {
      systemInstruction: req.system,
      abortSignal: req.signal,
      maxOutputTokens: req.maxTokens,
      responseMimeType: req.json ? 'application/json' : undefined,
      tools: req.webSearch || functions.length ? [...(req.webSearch ? [{ googleSearch: {} }] : []), ...functions] : undefined,
      thinkingConfig: thinkingFor(req.model, req.effort),
    };

    const stream = await withRetry(() => this.ai.models.generateContentStream({ model: req.model, contents, config }), req.signal);
    const toolCalls: ToolCall[] = [];
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      for (const p of candidate?.content?.parts ?? []) {
        if (p.functionCall?.name) {
          toolCalls.push({
            id: p.functionCall.id || `call_${toolCalls.length}`,
            name: p.functionCall.name,
            args: p.functionCall.args ?? {},
            signature: p.thoughtSignature,
          });
        }
      }
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('');
      const webSources = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((c) =>
        c.web?.uri ? [{ title: c.web.title || new URL(c.web.uri).hostname, uri: c.web.uri }] : [],
      );
      if (text || webSources.length) yield { text, webSources: webSources.length ? webSources : undefined };
      if (candidate?.finishReason === 'SAFETY') throw new ProviderError('Gemini blocked this response for safety reasons.', undefined, 'Gemini');
    }
    if (toolCalls.length) yield { toolCalls };
  }
}

export class GeminiEmbedder implements Embedder {
  readonly key: string;
  readonly batchSize = 100;
  private ai: GoogleGenAI;
  /** gemini-embedding-2 takes task instructions in the text instead of a taskType. */
  private readonly promptStyle: boolean;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
    this.key = `gemini:${model}:${dimensions}`;
    this.promptStyle = usesPromptStyle(model);
  }

  embedDocuments(docs: EmbedInput[], signal?: AbortSignal) {
    return this.call(geminiDocTexts(this.model, docs), 'RETRIEVAL_DOCUMENT', signal);
  }

  async embedQuery(query: string, signal?: AbortSignal) {
    const text = geminiQueryText(this.model, query);
    const [vector] = await this.call([text], 'RETRIEVAL_QUERY', signal);
    return vector;
  }

  private async call(texts: string[], taskType: string, signal?: AbortSignal): Promise<Float32Array[]> {
    const res = await withRetry(
      () =>
        this.ai.models.embedContent({
          model: this.model,
          // One Content per input yields one embedding per input.
          contents: texts.map((text) => ({ parts: [{ text }] })),
          config: {
            outputDimensionality: this.dimensions || undefined,
            taskType: this.promptStyle ? undefined : taskType,
            abortSignal: signal,
          },
        }),
      signal,
    );
    const vectors = (res.embeddings ?? []).map((e) => Float32Array.from(e.values ?? []));
    if (vectors.length !== texts.length || vectors.some((v) => !v.length)) {
      throw new ProviderError(`Gemini returned ${vectors.length} embeddings for ${texts.length} inputs.`, undefined, 'Gemini');
    }
    return vectors;
  }
}
