/** Parses the first JSON object or array in a model reply, tolerating code fences and stray prose. */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const close = text[start] === '{' ? '}' : ']';
  for (let end = text.lastIndexOf(close); end > start; end = text.lastIndexOf(close, end - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      // try a shorter span
    }
  }
  return null;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
