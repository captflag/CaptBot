import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isAbort } from '../providers/http';
import type { McpConnector } from '../settings';
import type { McpOutput, McpTool } from './index';

/** The most of one tool result the model reads; the rest is cut with a note. */
const MAX_OUTPUT = 20_000;
const CLIENT = { name: 'CaptBot', version: '2.0.0' };

/** One open session per server and token, reused across chats. */
const sessions = new Map<string, Promise<Client>>();
const keyOf = (c: McpConnector) => `${c.url.trim()}\n${c.token.trim()}`;

/** An error already worded for the user, so it isn't reworded again on the way out. */
class ConnectorError extends Error {}

/** Turns transport errors into something a person can act on. */
function explain(err: unknown, c: McpConnector): Error {
  if (isAbort(err) || err instanceof ConnectorError) return err as Error;
  if (err instanceof StreamableHTTPError && (err.code === 401 || err.code === 403)) {
    return new ConnectorError(`${c.name} refused access (${err.code}). Check the access token.`);
  }
  if (err instanceof TypeError) {
    return new ConnectorError(`Could not reach ${c.name}. Check the URL, or the server may not allow access from a browser (CORS).`);
  }
  return new ConnectorError(`${c.name}: ${err instanceof Error ? err.message : String(err)}`);
}

async function open(c: McpConnector): Promise<Client> {
  let url: URL;
  try {
    url = new URL(c.url.trim());
  } catch {
    throw new ConnectorError(`“${c.url}” is not a valid URL.`);
  }
  const token = c.token.trim();
  const requestInit: RequestInit | undefined = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  const client = new Client(CLIENT);
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit }));
    return client;
  } catch (err) {
    // Servers from before the Streamable HTTP transport turn its first request away; they speak HTTP+SSE.
    const legacy = err instanceof StreamableHTTPError && [400, 404, 405].includes(err.code ?? 0);
    if (!legacy) throw explain(err, c);
    const old = new Client(CLIENT);
    try {
      await old.connect(new SSEClientTransport(url, { requestInit }));
      return old;
    } catch {
      throw explain(err, c);
    }
  }
}

function session(c: McpConnector): Promise<Client> {
  const key = keyOf(c);
  let s = sessions.get(key);
  if (!s) {
    s = open(c);
    sessions.set(key, s);
    s.catch(() => sessions.delete(key));
  }
  return s;
}

/** Forgets a session that stopped working (the server restarted, say), so the next use reconnects. */
function drop(c: McpConnector) {
  const key = keyOf(c);
  const s = sessions.get(key);
  sessions.delete(key);
  void s?.then((client) => client.close()).catch(() => undefined);
}

async function listOnce(c: McpConnector, signal?: AbortSignal): Promise<McpTool[]> {
  const client = await session(c);
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { signal });
    for (const t of page.tools) {
      tools.push({ name: t.name, description: t.description ?? t.title ?? '', inputSchema: t.inputSchema as Record<string, unknown> });
    }
    cursor = page.nextCursor;
  } while (cursor && tools.length < 500);
  return tools;
}

export async function listTools(c: McpConnector, signal?: AbortSignal): Promise<McpTool[]> {
  try {
    return await listOnce(c, signal);
  } catch (err) {
    if (isAbort(err)) throw err;
    // Listing has no side effects, so a stale session gets one fresh try.
    drop(c);
    try {
      return await listOnce(c, signal);
    } catch (again) {
      throw explain(again, c);
    }
  }
}

interface Block {
  type?: string;
  text?: string;
  uri?: string;
  resource?: { uri?: string; text?: string };
}

/** A tool result as plain text for the model: text blocks as they are, anything else named. */
function toText(res: Record<string, unknown>): string {
  const blocks = (Array.isArray(res.content) ? res.content : []) as Block[];
  const parts = blocks.map((b) => {
    if (b.type === 'text') return b.text ?? '';
    if (b.type === 'resource') return b.resource?.text ?? `[resource ${b.resource?.uri ?? ''}]`;
    if (b.type === 'resource_link') return `[link ${b.uri ?? ''}]`;
    return `[${b.type ?? 'unknown'} content not shown]`;
  });
  if (!parts.join('').trim() && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
  if (!blocks.length && res.toolResult !== undefined) parts.push(JSON.stringify(res.toolResult));
  const text = parts.join('\n\n').trim() || '(the tool returned nothing)';
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n\n[cut: ${text.length - MAX_OUTPUT} more characters]` : text;
}

export async function callTool(c: McpConnector, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpOutput> {
  try {
    const client = await session(c);
    const res = await client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: 120_000 });
    return { text: toText(res as Record<string, unknown>), isError: res.isError === true };
  } catch (err) {
    if (isAbort(err)) throw err;
    // Not retried: the call may already have done something. The next call starts a new session.
    drop(c);
    throw explain(err, c);
  }
}
