import type { ToolSpec } from '../providers/types';
import type { McpConnector } from '../settings';

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

export interface McpOutput {
  text: string;
  isError: boolean;
}

/** The two things CaptBot asks of an MCP server. */
export interface McpApi {
  listTools(connector: McpConnector, signal?: AbortSignal): Promise<McpTool[]>;
  callTool(connector: McpConnector, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpOutput>;
}

/** Lets tests stand in for real servers. */
export const mcpOverrides: { api?: McpApi } = {};

/** The MCP client library loads on first use, so chats without connectors never download it. */
const api = (): Promise<McpApi> => (mcpOverrides.api ? Promise.resolve(mcpOverrides.api) : import('./client'));

export interface Toolbox {
  specs: ToolSpec[];
  /** The name the model sees → the connector and the server's own name for the tool. */
  route: Map<string, { connector: McpConnector; tool: string }>;
  /** Connectors that could not be reached, and why. */
  failures: { connector: string; error: string }[];
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * A model-facing name for a connector's tool: "connector__tool", within every provider's
 * limit of 64 characters from [a-zA-Z0-9_-], and unique among the names already taken.
 */
export function toolName(connector: string, tool: string, taken: Set<string>): string {
  const base = `${sanitize(connector).slice(0, 20) || 'mcp'}__${sanitize(tool) || 'tool'}`.slice(0, 60);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

/** Providers want an object schema with properties, and Gemini rejects a few JSON Schema keywords. */
function objectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return { type: 'object', properties: {}, ...rest };
}

/** Connects to every connector at once and gathers their tools. One that fails is reported, not fatal. */
export async function loadToolbox(connectors: McpConnector[], signal?: AbortSignal): Promise<Toolbox> {
  const m = await api();
  const settled = await Promise.allSettled(connectors.map((c) => m.listTools(c, signal)));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const box: Toolbox = { specs: [], route: new Map(), failures: [] };
  const taken = new Set<string>();
  settled.forEach((outcome, i) => {
    const connector = connectors[i];
    if (outcome.status === 'rejected') {
      box.failures.push({ connector: connector.name, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
      return;
    }
    for (const tool of outcome.value) {
      const name = toolName(connector.name, tool.name, taken);
      box.route.set(name, { connector, tool: tool.name });
      box.specs.push({ name, description: `[${connector.name}] ${tool.description}`.slice(0, 1024), parameters: objectSchema(tool.inputSchema) });
    }
  });
  return box;
}

/** Connects once and lists the tools, for the Test button in Settings. */
export async function testConnector(connector: McpConnector): Promise<McpTool[]> {
  return (await api()).listTools(connector);
}

export async function runTool(connector: McpConnector, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpOutput> {
  return (await api()).callTool(connector, tool, args, signal);
}
