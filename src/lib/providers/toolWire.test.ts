import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicChat } from './anthropic';
import { GeminiChat } from './gemini';
import { OpenAIChat } from './openai';
import type { ChatProvider, ChatRequest, ChatTurn, ToolCall, ToolSpec } from './types';

// A tool round trip against each provider's real client code, with the network replaced by
// streams shaped like the providers' documented responses. It checks what would go over the
// wire; it can't prove a live model accepts it, so try one with a real key before relying on it.

const weather: ToolSpec = {
  name: 'Weather__get_weather',
  description: 'Current weather for a city',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

const sse = (events: (string | [event: string, data: unknown])[]) =>
  events.map((e) => (typeof e === 'string' ? `data: ${e}\n\n` : `event: ${e[0]}\ndata: ${JSON.stringify(e[1])}\n\n`)).join('');

/** Answers each request with the next canned stream, and keeps what was sent. */
function fakeNetwork(...replies: string[]) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const raw = init?.body ?? (input instanceof Request ? await input.text() : '{}');
      sent.push({ url, body: JSON.parse(String(raw)) as Record<string, unknown> });
      return new Response(replies.shift() ?? '', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return sent;
}

async function run(provider: ChatProvider, req: ChatRequest) {
  let text = '';
  let calls: ToolCall[] = [];
  for await (const d of provider.stream(req)) {
    text += d.text ?? '';
    if (d.toolCalls) calls = d.toolCalls;
  }
  return { text, calls };
}

/** Round one asks for the tool; round two sends the call and its result back. */
async function roundTrip(provider: ChatProvider, model: string) {
  const question: ChatTurn = { role: 'user', content: 'Weather in Pune?' };
  const first = await run(provider, { model, messages: [question], tools: [weather] });
  const call = first.calls[0];
  const second = await run(provider, {
    model,
    tools: [weather],
    messages: [
      question,
      { role: 'assistant', content: first.text, toolCalls: first.calls },
      { role: 'user', content: '', toolResults: [{ id: call.id, name: call.name, output: '21°C and clear' }] },
    ],
  });
  return { first, second };
}

afterEach(() => vi.unstubAllGlobals());

describe('tool calls on the wire', () => {
  it('OpenAI Chat Completions', async () => {
    const sent = fakeNetwork(
      sse([
        JSON.stringify({ choices: [{ delta: { content: 'Checking.' } }] }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: weather.name, arguments: '' } }] } }],
        }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Pune"}' } }] }, finish_reason: 'tool_calls' }] }),
        '[DONE]',
      ]),
      sse([JSON.stringify({ choices: [{ delta: { content: 'It is 21°C.' } }] }), '[DONE]']),
    );
    const { first, second } = await roundTrip(new OpenAIChat('openai', 'sk-test', 'https://api.openai.com/v1'), 'gpt-5');

    expect(first.calls).toEqual([{ id: 'call_1', name: weather.name, args: { city: 'Pune' } }]);
    expect(sent[0].body.tools).toEqual([
      { type: 'function', function: { name: weather.name, description: weather.description, parameters: weather.parameters } },
    ]);
    expect((sent[1].body.messages as unknown[]).slice(-2)).toEqual([
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: weather.name, arguments: '{"city":"Pune"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '21°C and clear' },
    ]);
    expect(second.text).toBe('It is 21°C.');
  });

  it('Anthropic Messages', async () => {
    const message = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    };
    const sent = fakeNetwork(
      sse([
        ['message_start', { type: 'message_start', message }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking.' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: weather.name, input: {} } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"Pune"}' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
        ['message_stop', { type: 'message_stop' }],
      ]),
      sse([
        ['message_start', { type: 'message_start', message }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'It is 21°C.' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
        ['message_stop', { type: 'message_stop' }],
      ]),
    );
    const { first, second } = await roundTrip(new AnthropicChat('sk-ant-test'), 'claude-sonnet-5-5');

    expect(first.calls).toEqual([{ id: 'toolu_1', name: weather.name, args: { city: 'Pune' } }]);
    expect(sent[0].url).toContain('/v1/messages');
    expect(sent[0].body.tools).toEqual([{ name: weather.name, description: weather.description, input_schema: weather.parameters }]);
    expect((sent[1].body.messages as unknown[]).slice(-2)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_1', name: weather.name, input: { city: 'Pune' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '21°C and clear' }] },
    ]);
    expect(second.text).toBe('It is 21°C.');
  });

  it('Gemini generateContent', async () => {
    const sent = fakeNetwork(
      sse([
        JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Checking.' }] } }] }),
        JSON.stringify({
          candidates: [
            {
              content: { role: 'model', parts: [{ functionCall: { name: weather.name, args: { city: 'Pune' } }, thoughtSignature: 'c2ln' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      ]),
      sse([JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'It is 21°C.' }] }, finishReason: 'STOP' }] })]),
    );
    const { first, second } = await roundTrip(new GeminiChat('gm-test'), 'gemini-3-flash-preview');

    expect(first.calls).toEqual([{ id: 'call_0', name: weather.name, args: { city: 'Pune' }, signature: 'c2ln' }]);
    expect(sent[0].url).toContain(':streamGenerateContent');
    expect(sent[0].body.tools).toEqual([
      { functionDeclarations: [{ name: weather.name, description: weather.description, parametersJsonSchema: weather.parameters }] },
    ]);
    expect((sent[1].body.contents as unknown[]).slice(-2)).toEqual([
      {
        role: 'model',
        parts: [{ text: 'Checking.' }, { functionCall: { id: 'call_0', name: weather.name, args: { city: 'Pune' } }, thoughtSignature: 'c2ln' }],
      },
      { role: 'user', parts: [{ functionResponse: { id: 'call_0', name: weather.name, response: { output: '21°C and clear' } } }] },
    ]);
    expect(second.text).toBe('It is 21°C.');
  });
});
