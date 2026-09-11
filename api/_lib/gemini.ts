import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part, type ThinkingConfig } from '@google/genai';
import type { ChatBody, ChatDeltaBody, EmbedBody, Effort } from './contract.js';
import { HttpError, type ChatBackend, type EmbedBackend } from './handlers.js';

export interface GeminiServerConfig {
  apiKey: string;
  mainModel: string;
  fastModel: string;
  /** Embedding models the free tier will run (anything else is rejected). */
  embedModels: string[];
}

export function readGeminiConfig(env: Record<string, string | undefined>): GeminiServerConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    mainModel: env.FREE_CHAT_MODEL?.trim() || 'gemini-3.8-flash',
    fastModel: env.FREE_FAST_MODEL?.trim() || 'gemini-3.5-flash-lite',
    embedModels: (env.FREE_EMBED_MODELS ?? 'gemini-embedding-2,gemini-embedding-001').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

// Mirrors the browser Gemini provider so free-tier and own-key answers behave the same.
function thinkingFor(model: string, effort: Effort = 'normal'): ThinkingConfig | undefined {
  if (effort === 'normal') return undefined;
  const pro = /pro/.test(model);
  if (/gemini-3/.test(model)) {
    if (effort === 'low') return { thinkingLevel: pro ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL };
    return { thinkingLevel: ThinkingLevel.HIGH };
  }
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: effort === 'low' ? (pro ? 128 : 0) : -1 };
  return undefined;
}

export function geminiBackends(cfg: GeminiServerConfig): { chat: ChatBackend; embed: EmbedBackend } {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });

  const chat: ChatBackend = {
    async *stream(body: ChatBody, signal: AbortSignal): AsyncGenerator<ChatDeltaBody> {
      const model = body.tier === 'fast' ? cfg.fastModel : cfg.mainModel;
      const contents: Content[] = body.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.images ?? []).map((img): Part => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
          ...(m.content ? [{ text: m.content }] : []),
        ],
      }));
      const config: GenerateContentConfig = {
        systemInstruction: body.system,
        abortSignal: signal,
        maxOutputTokens: body.maxTokens,
        responseMimeType: body.json ? 'application/json' : undefined,
        tools: body.webSearch ? [{ googleSearch: {} }] : undefined,
        thinkingConfig: thinkingFor(model, body.effort),
      };
      const stream = await ai.models.generateContentStream({ model, contents, config });
      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        const text = (candidate?.content?.parts ?? [])
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text)
          .join('');
        const webSources = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((c) =>
          c.web?.uri ? [{ title: c.web.title || new URL(c.web.uri).hostname, uri: c.web.uri }] : [],
        );
        if (text || webSources.length) yield { text, webSources: webSources.length ? webSources : undefined };
        if (candidate?.finishReason === 'SAFETY') throw new HttpError(422, 'Gemini blocked this response for safety reasons.');
      }
    },
  };

  const embed: EmbedBackend = {
    async embed(body: EmbedBody, signal: AbortSignal): Promise<number[][]> {
      if (!cfg.embedModels.includes(body.model)) {
        throw new HttpError(400, `The free tier embeds with ${cfg.embedModels.join(' or ')}. Change the embedding model in Settings, or add your own key.`);
      }
      const res = await ai.models.embedContent({
        model: body.model,
        contents: body.texts.map((text) => ({ parts: [{ text }] })),
        config: { outputDimensionality: body.dimensions || undefined, taskType: body.taskType, abortSignal: signal },
      });
      const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== body.texts.length || vectors.some((v) => !v.length)) {
        throw new HttpError(502, 'The embedding provider returned an incomplete response.');
      }
      return vectors;
    },
  };

  return { chat, embed };
}
