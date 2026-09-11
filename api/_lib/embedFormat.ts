/** "report.pdf › Methods › Sampling": the document and section a chunk comes from. */
export const contextTitle = (docName: string, headingPath: string[]) => [docName, ...headingPath].join(' › ');

/** What gets embedded for a chunk: its text, after any prefix (a split table's header). */
export const embedText = (c: { text: string; prefix?: string }) => (c.prefix ? `${c.prefix}\n${c.text}` : c.text);

// gemini-embedding-2 takes its task as a text prefix; mirrors the browser's geminiFormat.ts.
export const documentInput = (title: string, text: string) => `title: ${title || 'none'} | text: ${text}`;
export const queryInput = (query: string) => `task: search result | query: ${query}`;

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have how i if in into is it its of on or ' +
    'that the their then there these this to was were what when where which who why will with ' +
    'you your do does did can could should would about me my we our'
  ).split(' '),
);

/**
 * The keyword half of hybrid search: the question's words OR-ed together, prefix-matched when
 * they're long enough, as Postgres tsquery text. Only letters and digits get through, so the
 * result is always valid tsquery syntax.
 */
export function toTsQuery(query: string): string {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return [...new Set(words)]
    .slice(0, 24)
    .map((w) => (w.length > 3 ? `${w}:*` : w))
    .join(' | ');
}
