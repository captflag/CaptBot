import { afterEach, describe, expect, it } from 'vitest';
import { providerOverrides } from '../providers';
import type { ChatProvider } from '../providers/types';
import { defaultSettings, type Settings } from '../settings';
import type { Chunk, RerankMode } from '../types';
import { buildSources, retrieve, type CandidateSource, type Retrieved } from './retrieve';
import { estimateTokens, mostlyNonLatin } from './tokens';

const DOC = 'Sentence zero here. Sentence one here. Sentence two here. Sentence three here.  Far away, sentence four here.';

function span(id: string, ordinal: number, from: string, to: string, extra: Partial<Chunk> = {}): Chunk {
  const start = DOC.indexOf(from);
  const end = DOC.indexOf(to) + to.length;
  return { id, docId: 'd', ordinal, start, end, text: DOC.slice(start, end), headingPath: [], ...extra };
}

// c0 and c1 overlap on "Sentence one", c2 starts one space after c1, c3 sits far from c2.
const c0 = span('c0', 0, 'Sentence zero', 'one here.');
const c1 = span('c1', 1, 'Sentence one', 'two here.');
const c2 = span('c2', 2, 'Sentence three', 'three here.');
const c3 = span('c3', 3, 'sentence four', 'four here.');
const hit = (chunk: Chunk, neighbors: Chunk[] = [], score = 1): Retrieved => ({ chunk, doc: { id: 'd', name: 'doc.md' }, score, neighbors });

describe('buildSources', () => {
  it('widens a hit with its neighbours and merges them into one excerpt', () => {
    const [source] = buildSources([hit(c1, [c0, c2])], 6000);
    expect(source).toMatchObject({ n: 1, chunkId: 'c1', start: c0.start, end: c2.end });
    expect(source.text).toContain('Sentence zero here.');
    expect(source.text).toContain('Sentence three here.');
    // The overlap between c0 and c1 appears once.
    expect(source.text.match(/Sentence one here/g)).toHaveLength(1);
  });

  it('only widens while the budget allows', () => {
    const sources = buildSources([hit(c1, [c0, c2])], estimateTokens(c1.text));
    expect(sources).toHaveLength(1);
    expect(sources[0].text).toBe(c1.text);
  });

  it('keeps distant hits apart and numbers them by rank', () => {
    const sources = buildSources([hit(c3, [], 2), hit(c1, [], 1)], 6000);
    expect(sources.map((s) => s.chunkId)).toEqual(['c3', 'c1']);
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it('merges two hits that touch into one source', () => {
    const sources = buildSources([hit(c1), hit(c2)], 6000);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ chunkId: 'c1', start: c1.start, end: c2.end });
  });

  it("carries a split table's header prefix", () => {
    const withPrefix = { ...c3, prefix: '| a | b |\n| --- | --- |' };
    expect(buildSources([hit(withPrefix)], 6000)[0].prefix).toBe('| a | b |\n| --- | --- |');
  });
});

describe('retrieve: relevance filter', () => {
  const refund: Retrieved = { chunk: { ...c0, id: 'refund', text: 'Refunds are accepted within 30 days.' }, doc: { id: 'd', name: 'policy.md' }, score: 3 };
  const other = (id: string, at: number): Retrieved => ({
    chunk: { ...c0, id, ordinal: at, start: at * 100, end: at * 100 + 50, text: `Unrelated ${id} text.` },
    doc: { id: 'e', name: 'misc.md' },
    score: 2,
  });
  const source: CandidateSource = { search: async () => ({ candidates: [other('x', 9), refund, other('y', 12)], warnings: [] }) };

  const settingsWith = (rerank: RerankMode, filterIrrelevant = true): Settings => {
    const base = defaultSettings();
    return { ...base, retrieval: { ...base.retrieval, rerank, filterIrrelevant } };
  };
  const chatReplying = (text: string): ChatProvider => ({
    id: 'gemini',
    supportsWebSearch: false,
    async *stream() {
      yield { text };
    },
  });
  const run = (query: string, settings: Settings, chat = chatReplying('{}')) =>
    retrieve({ query, docIds: new Set(['d', 'e']), collectionIds: [], embedder: null, embeddingKey: 'k', chat, settings, source });

  afterEach(() => {
    delete providerOverrides.reranker;
  });

  it('drops passages the cross-encoder judges irrelevant', async () => {
    providerOverrides.reranker = async (_q, passages) => passages.map((p) => (p.includes('Refunds') ? 0.92 : 0.001));
    const res = await run('refund window', settingsWith('local'));
    expect(res.results.map((r) => r.chunk.id)).toEqual(['refund']);
    expect(res.dropped).toBe(2);
    expect(res.reranker).toBe('local');
  });

  it('returns nothing when no passage is relevant', async () => {
    providerOverrides.reranker = async (_q, passages) => passages.map(() => 0.002);
    const res = await run('capital of Mongolia', settingsWith('local'));
    expect(res.results).toEqual([]);
    expect(res.dropped).toBe(3);
  });

  it('keeps everything when the filter is off', async () => {
    providerOverrides.reranker = async (_q, passages) => passages.map(() => 0.002);
    const res = await run('capital of Mongolia', settingsWith('local', false));
    expect(res.results).toHaveLength(3);
    expect(res.dropped).toBe(0);
  });

  it('hands non-Latin queries to the chat model, which can leave passages out', async () => {
    providerOverrides.reranker = async () => {
      throw new Error('the English-only cross-encoder should not run');
    };
    const res = await run('返金の期限はいつですか', settingsWith('local'), chatReplying('{"ranking": [2]}'));
    expect(res.reranker).toBe('llm');
    expect(res.results.map((r) => r.chunk.id)).toEqual(['refund']);
  });

  it.each([
    ['no ranking at all', '{"answer": "none of them"}'],
    ['only passages that do not exist', '{"ranking": [7, 9]}'],
  ])('keeps every passage when the chat model replies with %s', async (_label, reply) => {
    const res = await run('返金の期限はいつですか', settingsWith('local'), chatReplying(reply));
    expect(res.reranker).toBe('none');
    expect(res.results).toHaveLength(3);
    expect(res.warnings.join(' ')).toMatch(/Reranking was skipped/);
  });

  it('keeps retrieval order and skips the filter when reranking fails', async () => {
    providerOverrides.reranker = async () => {
      throw new Error('model download failed');
    };
    const res = await run('refund window', settingsWith('local'));
    expect(res.reranker).toBe('none');
    expect(res.results).toHaveLength(3);
    expect(res.warnings.join(' ')).toMatch(/Reranking was skipped/);
  });
});

describe('tokens', () => {
  it('counts CJK characters as about one token each', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('日本語です')).toBe(5);
  });

  it('spots non-Latin scripts', () => {
    expect(mostlyNonLatin('How long is the refund window?')).toBe(false);
    expect(mostlyNonLatin('Wie lange gilt die Rückgabefrist?')).toBe(false);
    expect(mostlyNonLatin('返金の期限はいつですか')).toBe(true);
    expect(mostlyNonLatin('रिफंड की समय सीमा क्या है')).toBe(true);
  });
});
