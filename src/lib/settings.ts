import { useSyncExternalStore } from 'react';
import { profileKey } from './auth/profile';
import type { ChatProviderId, EmbeddingProviderId, RerankMode } from './types';

/** A remote MCP server whose tools the chat model may call. Kept in this browser, never synced. */
export interface McpConnector {
  id: string;
  name: string;
  /** Streamable HTTP endpoint (older HTTP+SSE servers work too). */
  url: string;
  /** Sent as "Authorization: Bearer …" when set. */
  token: string;
  enabled: boolean;
  /** Tools (by the server's own name) that run without asking first. */
  alwaysAllow: string[];
}

export interface Settings {
  displayName: string;
  theme: 'light' | 'dark';
  font: string;
  chat: {
    provider: ChatProviderId;
    /** Answers and research reports. */
    model: string;
    /** Utility calls: follow-up rewriting, research planning, LLM reranking. */
    fastModel: string;
  };
  embeddings: {
    provider: EmbeddingProviderId;
    model: string;
    /** 0 means the model's native size. */
    dimensions: number;
  };
  retrieval: {
    hybrid: boolean;
    rerank: RerankMode;
    /** Leave out passages the reranker judges irrelevant, instead of always sending the top matches. */
    filterIrrelevant: boolean;
    candidates: number;
    topK: number;
    contextTokens: number;
    rewriteQueries: boolean;
  };
  keys: Record<'gemini' | 'openai' | 'anthropic' | 'compatible', string>;
  compatibleBaseUrl: string;
  /** Optional URL prefix used to fetch web pages that block browser (CORS) access. */
  readerProxy: string;
  connectors: McpConnector[];
}

export const CHAT_PRESETS: Record<ChatProviderId, { label: string; main: string; fast: string; models: string[] }> = {
  gemini: {
    label: 'Google Gemini',
    main: 'gemini-3.8-flash',
    fast: 'gemini-3.5-flash-lite',
    models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite', 'gemini-2.5-pro'],
  },
  anthropic: {
    label: 'Anthropic Claude',
    main: 'claude-opus-5',
    fast: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1'],
  },
  openai: {
    label: 'OpenAI',
    main: 'gpt-5.6-sol',
    fast: 'gpt-5.6-luna',
    models: ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6-astra'],
  },
  compatible: {
    label: 'OpenAI-compatible (Ollama, LM Studio, OpenRouter…)',
    main: 'llama3.1',
    fast: 'llama3.1',
    models: [],
  },
};

export const EMBEDDING_PRESETS: Record<EmbeddingProviderId, { label: string; model: string; dimensions: number; models: string[] }> = {
  gemini: { label: 'Google Gemini', model: 'gemini-embedding-2', dimensions: 768, models: ['gemini-embedding-2', 'gemini-embedding-001'] },
  openai: { label: 'OpenAI', model: 'text-embedding-3-small', dimensions: 768, models: ['text-embedding-3-small', 'text-embedding-3-large'] },
  compatible: { label: 'OpenAI-compatible', model: 'nomic-embed-text', dimensions: 0, models: [] },
  local: { label: 'Local, in-browser (private, no key)', model: 'Xenova/bge-small-en-v1.5', dimensions: 384, models: ['Xenova/bge-small-en-v1.5'] },
};

const STORAGE_KEY = 'captbot_settings_v2';

function systemTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('captbot_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function defaultSettings(): Settings {
  return {
    displayName: '',
    theme: systemTheme(),
    font: 'Plus Jakarta Sans',
    chat: { provider: 'gemini', model: CHAT_PRESETS.gemini.main, fastModel: CHAT_PRESETS.gemini.fast },
    embeddings: { provider: 'gemini', model: EMBEDDING_PRESETS.gemini.model, dimensions: EMBEDDING_PRESETS.gemini.dimensions },
    retrieval: { hybrid: true, rerank: 'local', filterIrrelevant: true, candidates: 30, topK: 8, contextTokens: 6000, rewriteQueries: true },
    keys: { gemini: '', openai: '', anthropic: '', compatible: '' },
    compatibleBaseUrl: 'http://localhost:11434/v1',
    readerProxy: '',
    connectors: [],
  };
}

function load(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(profileKey(STORAGE_KEY));
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...saved,
      theme: base.theme,
      // Inter was the old default face and is no longer offered; anyone still on it moves to the new default.
      font: !saved.font || saved.font === 'Inter' ? base.font : saved.font,
      chat: { ...base.chat, ...saved.chat },
      embeddings: { ...base.embeddings, ...saved.embeddings },
      retrieval: { ...base.retrieval, ...saved.retrieval },
      keys: { ...base.keys, ...saved.keys },
    };
  } catch {
    return base;
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

/** Re-reads settings for the active profile, e.g. after sign-in switches users. */
export function reloadSettings() {
  current = load();
  listeners.forEach((l) => l());
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Settings)) {
  const previousTheme = current.theme;
  current = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
  try {
    localStorage.setItem(profileKey(STORAGE_KEY), JSON.stringify(current));
    // Only an explicit theme change pins the theme; otherwise it keeps following the OS.
    if (current.theme !== previousTheme) localStorage.setItem('captbot_theme', current.theme);
  } catch {
    // Storage can be unavailable (private mode); settings still apply for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}

/** Identifies a vector space; vectors from different keys are never compared. */
export function embeddingKeyOf(s: Settings): string {
  const { provider, model, dimensions } = s.embeddings;
  const dims = provider === 'local' ? EMBEDDING_PRESETS.local.dimensions : dimensions;
  return `${provider}:${model}:${dims}`;
}

export function hasChatKey(s: Settings): boolean {
  return s.chat.provider === 'compatible' || Boolean(s.keys[s.chat.provider].trim());
}
