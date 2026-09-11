/**
 * Citation markers look like [1], [2, 4] or [3-5]. The lookbehind skips code
 * such as arr[1] and images; the lookahead skips real markdown links [1](...)
 * and reference definitions [1]: url.
 */
const CITE_RE = /(?<![\w\\!])\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\](?![(:])/g;
const FENCED_RE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

function expand(group: string, max: number): number[] {
  const out: number[] = [];
  for (const part of group.split(/[,;]/)) {
    const range = part.split(/[–-]/).map((s) => parseInt(s.trim(), 10));
    if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] <= 20) {
      for (let n = range[0]; n <= range[1]; n++) out.push(n);
    } else if (!Number.isNaN(range[0])) {
      out.push(range[0]);
    }
  }
  return out.filter((n) => n >= 1 && n <= max);
}

/** Applies `fn` to the parts of a markdown string that are not code. */
function mapProse(markdown: string, fn: (prose: string) => string): string {
  const mapInline = (s: string) => {
    let out = '';
    let last = 0;
    for (const m of s.matchAll(INLINE_CODE_RE)) {
      out += fn(s.slice(last, m.index)) + m[0];
      last = m.index + m[0].length;
    }
    return out + fn(s.slice(last));
  };
  let out = '';
  let last = 0;
  for (const m of markdown.matchAll(FENCED_RE)) {
    out += mapInline(markdown.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + mapInline(markdown.slice(last));
}

/** Source numbers cited in `text`, in order of first appearance. */
export function extractCitations(text: string, max: number): number[] {
  const seen = new Set<number>();
  mapProse(text, (prose) => {
    for (const m of prose.matchAll(CITE_RE)) for (const n of expand(m[1], max)) seen.add(n);
    return prose;
  });
  return [...seen];
}

/** Rewrites [n] markers into `[n](#cite-n)` links that the renderer turns into chips. */
export function linkifyCitations(markdown: string, max: number): string {
  if (max <= 0) return markdown;
  return mapProse(markdown, (prose) =>
    prose.replace(CITE_RE, (whole, group: string) => {
      const nums = expand(group, max);
      return nums.length ? nums.map((n) => `[${n}](#cite-${n})`).join('') : whole;
    }),
  );
}

/** Removes citation markers, e.g. before replaying an old answer as conversation history. */
export function stripCitations(text: string): string {
  return mapProse(text, (prose) => prose.replace(new RegExp(`\\s?${CITE_RE.source}`, 'g'), ''));
}
