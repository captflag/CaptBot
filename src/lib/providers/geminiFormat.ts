import type { EmbedInput } from './types';

/** gemini-embedding-2 takes the task as a text prefix; gemini-embedding-001 uses taskType instead. */
export const usesPromptStyle = (model: string) => !model.includes('embedding-001');

export function geminiDocTexts(model: string, docs: EmbedInput[]): string[] {
  return docs.map((d) => (usesPromptStyle(model) ? `title: ${d.title || 'none'} | text: ${d.text}` : `${d.title}\n\n${d.text}`));
}

export function geminiQueryText(model: string, query: string): string {
  return usesPromptStyle(model) ? `task: search result | query: ${query}` : query;
}
