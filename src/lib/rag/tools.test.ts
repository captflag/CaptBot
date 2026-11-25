import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { mcpOverrides, toolName, type McpApi } from '../mcp';
import { providerOverrides } from '../providers';
import type { ChatDelta, ChatProvider, ChatRequest } from '../providers/types';
import { getSettings, updateSettings, type McpConnector } from '../settings';
import type { ToolRun } from '../types';
import { answer, type AnswerEvent, type ToolDecision } from './answer';

/** Asks for the weather tool once, then answers with whatever the tool returned. */
class ToolChat implements ChatProvider {
  readonly id = 'openai' as const;
  readonly supportsWebSearch = false;
  readonly supportsTools = true;
  requests: ChatRequest[] = [];
  async *stream(req: ChatRequest): AsyncGenerator<ChatDelta> {
    this.requests.push(req);
    const last = req.messages.at(-1)!;
    if (last.toolResults) {
      const r = last.toolResults[0];
      yield { text: r.isError ? `No weather: ${r.output}` : `It is ${r.output}.` };
      return;
    }
    if (!req.tools?.length) {
      yield { text: 'No tools available.' };
      return;
    }
    yield { text: 'Checking.' };
    yield { toolCalls: [{ id: 'call_1', name: req.tools[0].name, args: { city: 'Pune' } }] };
  }
}

const weather: McpConnector = { id: 'c1', name: 'Weather', url: 'https://weather.example/mcp', token: '', enabled: true, alwaysAllow: [] };
const chat = new ToolChat();
const calls: { tool: string; args: Record<string, unknown> }[] = [];
let reachable = true;

const fakeServer: McpApi = {
  async listTools() {
    if (!reachable) throw new Error('Could not reach Weather.');
    return [{ name: 'get_weather', description: 'Current weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }];
  },
  async callTool(_c, tool, args) {
    calls.push({ tool, args });
    return { text: '21°C and clear', isError: false };
  },
};

async function ask(approve?: (run: ToolRun) => Promise<ToolDecision>) {
  const events: AnswerEvent[] = [];
  for await (const e of answer({
    thread: { collectionIds: [] },
    history: [],
    question: 'Weather in Pune?',
    mode: 'chat',
    webSearch: false,
    tools: true,
    approve,
    signal: new AbortController().signal,
  })) {
    events.push(e);
  }
  const text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
  const runs = events.flatMap((e) => (e.type === 'tools' ? [e.runs] : [])).at(-1) ?? [];
  return { text, runs };
}

beforeEach(async () => {
  providerOverrides.chat = chat;
  mcpOverrides.api = fakeServer;
  chat.requests = [];
  calls.length = 0;
  reachable = true;
  updateSettings({ connectors: [{ ...weather }] });
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterAll(() => {
  delete providerOverrides.chat;
  delete mcpOverrides.api;
  updateSettings({ connectors: [] });
});

describe('connector tools', () => {
  it('asks first, runs the tool, and answers from its result', async () => {
    const asked: ToolRun[] = [];
    const { text, runs } = await ask(async (run) => {
      asked.push(run);
      return 'once';
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ connector: 'Weather', tool: 'get_weather', status: 'approval' });
    expect(calls).toEqual([{ tool: 'get_weather', args: { city: 'Pune' } }]);
    expect(text).toBe('Checking.\n\nIt is 21°C and clear.');
    expect(runs).toMatchObject([{ status: 'done', output: '21°C and clear' }]);
    // The second round carried the call and its result back to the model.
    const second = chat.requests[1].messages;
    expect(second.at(-2)?.toolCalls?.[0].id).toBe('call_1');
    expect(second.at(-1)?.toolResults?.[0]).toMatchObject({ id: 'call_1', output: '21°C and clear' });
  });

  it('remembers "always allow" and stops asking for that tool', async () => {
    await ask(async () => 'always');
    expect(getSettings().connectors[0].alwaysAllow).toEqual(['get_weather']);
    let asked = 0;
    await ask(async () => {
      asked++;
      return 'deny';
    });
    expect(asked).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it('tells the model when the user declines, and runs nothing', async () => {
    const { text, runs } = await ask(async () => 'deny');
    expect(calls).toHaveLength(0);
    expect(runs).toMatchObject([{ status: 'denied' }]);
    expect(text).toContain('No weather: The user declined');
  });

  it('declines when nobody can be asked', async () => {
    const { runs } = await ask(undefined);
    expect(calls).toHaveLength(0);
    expect(runs).toMatchObject([{ status: 'denied' }]);
  });

  it('reports a connector it cannot reach and answers without tools', async () => {
    reachable = false;
    const { text, runs } = await ask(async () => 'once');
    expect(runs).toMatchObject([{ connector: 'Weather', tool: '', status: 'error', output: 'Could not reach Weather.' }]);
    expect(text).toBe('No tools available.');
  });

  it('leaves tools out when they are switched off for the message', async () => {
    const events: AnswerEvent[] = [];
    for await (const e of answer({ thread: { collectionIds: [] }, history: [], question: 'Hi', mode: 'chat', webSearch: false, tools: false, signal: new AbortController().signal })) {
      events.push(e);
    }
    expect(chat.requests[0].tools).toBeUndefined();
  });
});

describe('toolName', () => {
  it('keeps names within what every provider accepts, and unique', () => {
    const taken = new Set<string>();
    expect(toolName('My Jira!', 'search issues', taken)).toBe('My_Jira__search_issues');
    expect(toolName('My Jira!', 'search issues', taken)).toBe('My_Jira__search_issues_2');
    const long = toolName('x'.repeat(50), 'y'.repeat(80), taken);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
