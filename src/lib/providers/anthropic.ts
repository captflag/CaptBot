import Anthropic from '@anthropic-ai/sdk';
import type { ChatDelta, ChatProvider, ChatRequest, Effort } from './types';
import { ProviderError } from './types';

type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Maps the app's effort to output_config.effort on models that support it. */
function effortFor(model: string, effort: Effort = 'normal'): EffortLevel | undefined {
  if (effort === 'normal') return undefined;
  if (/haiku|claude-3|sonnet-4-5|sonnet-4-[0-4]|opus-4-[0-4](?!\d)/.test(model)) return undefined;
  if (effort === 'low') return 'low';
  // xhigh arrived with Opus 4.7; older effort-capable models top out at high (their default).
  return /opus-4-5|opus-4-6|sonnet-4-6/.test(model) ? undefined : 'xhigh';
}

/** Server-side refusal fallbacks are offered on the Opus 5 / Fable 5.1 tier. */
function supportsFallbacks(model: string) {
  return /claude-(opus-5|fable-5-1)/.test(model);
}

export class AnthropicChat implements ChatProvider {
  readonly id = 'anthropic' as const;
  readonly supportsWebSearch = false;
  private client: Anthropic;

  constructor(apiKey: string) {
    // The key is supplied by the user and never leaves their browser except to api.anthropic.com.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  async *stream(req: ChatRequest): AsyncGenerator<ChatDelta> {
    const system = req.json
      ? `${req.system ?? ''}\n\nReply with a single valid JSON value and nothing else — no prose, no code fences.`.trim()
      : req.system;
    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => {
      const content: Anthropic.Beta.BetaContentBlockParam[] = (m.images ?? []).map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType as ImageMediaType, data: img.data },
        }),
      );
      // Empty text blocks are rejected (e.g. an image-only question).
      if (m.content) content.push({ type: 'text', text: m.content });
      return { role: m.role, content };
    });
    const effort = effortFor(req.model, req.effort);

    const stream = this.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 64000,
        system,
        messages,
        ...(effort ? { output_config: { effort } } : {}),
        ...(supportsFallbacks(req.model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      },
      { signal: req.signal },
    );

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { text: event.delta.text };
        } else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
          throw new ProviderError('Claude declined to answer this request.', undefined, 'Anthropic');
        }
      }
    } catch (err) {
      // The SDK's abort error isn't named "AbortError"; normalise it so callers treat Stop as a stop.
      if (err instanceof Anthropic.APIUserAbortError) throw new DOMException('Aborted', 'AbortError');
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError('Anthropic rejected the API key. Check it in Settings.', err.status, 'Anthropic');
      }
      if (err instanceof Anthropic.APIError && !(err instanceof Anthropic.APIUserAbortError)) {
        throw new ProviderError(`Anthropic error ${err.status ?? ''}: ${err.message}`.trim(), err.status, 'Anthropic');
      }
      throw err;
    }
  }
}
