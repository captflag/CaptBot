import { db } from '../db';
import { providerOverrides } from '../providers';
import { isAbort, withRetry } from '../providers/http';
import { LOCAL_RERANKER, localModels } from '../providers/local';
import { complete, type ChatProvider, type Embedder } from '../providers/types';
import { RERANK_SYSTEM } from '../prompts';
import type { Settings } from '../settings';
import type { Chunk, KbDocument, RerankMode, SourceRef } from '../types';
import { reciprocalRankFusion, type Ranked } from './fusion';
import { errorText, parseJsonLoose } from './json';
import { contextTitle, embedText, knowledge } from './store';
import { estimateTokens, mostlyNonLatin } from './tokens';

export interface Retrieved {
  chunk: Chunk;
  doc: Pick<KbDocument, 'id' | 'name'>;
  score: number;
  /** The reranker's verdict: relevance probability from the cross-encoder, or 1/0 for kept/left out by the LLM. */
  relevance?: number;
  /** The chunks right before and after this one in its document, for widening the excerpt. */
  neighbors?: Chunk[];
}

export interface SearchRequest {
  query: string;
  /** Ready documents in the chat's scope. */
  docIds: Set<string>;
  /** The chat's collections; empty means the whole knowledge base. */
  collectionIds: string[];
  limit: number;
  /** null when the embedding provider isn't usable (e.g. missing key): keyword search only. */
  embedder: Embedder | null;
  embeddingKey: string;
  hybrid: boolean;
  signal?: AbortSignal;
}

export interface CandidateSet {
  candidates: Retrieved[];
  warnings: string[];
}

/** Where first-stage candidates come from: the in-browser indexes, or the account's server index. */
export interface CandidateSource {
  search(req: SearchRequest): Promise<CandidateSet>;
}

/** Exact vector search plus BM25 over the in-browser indexes, fused with reciprocal rank fusion. */
export const localCandidates: CandidateSource = {
  async search(req) {
    const warnings: string[] = [];
    await knowledge.ensureLoaded(req.embeddingKey);

    const lists: Ranked[][] = [];
    const embedder = req.embedder;
    if (!embedder) {
      warnings.push('Semantic search is off because the embedding provider is not set up, so keyword search was used.');
    } else if (knowledge.vectorCount > 0) {
      try {
        const qv = await withRetry(() => embedder.embedQuery(req.query, req.signal), req.signal);
        lists.push(knowledge.vectorSearch(qv, req.limit, req.docIds));
      } catch (err) {
        if (isAbort(err)) throw err;
        warnings.push(`Semantic search failed (${errorText(err)}), so keyword search was used.`);
      }
    } else {
      warnings.push('No documents are indexed with the current embedding model, so only keyword search ran. Re-index from the Knowledge page.');
    }
    if (req.hybrid || !lists.length) lists.push(knowledge.lexicalSearch(req.query, req.limit, req.docIds));

    const fused = reciprocalRankFusion(lists).slice(0, req.limit);
    return { candidates: await hydrate(fused), warnings };
  },
};

async function hydrate(ranked: Ranked[]): Promise<Retrieved[]> {
  const chunks = await db.chunks.bulkGet(ranked.map((r) => r.id));
  const found = chunks.filter((c): c is Chunk => Boolean(c));
  const docs = new Map(
    (await db.documents.bulkGet([...new Set(found.map((c) => c.docId))])).flatMap((d) => (d ? [[d.id, d] as const] : [])),
  );
  // The chunks either side of each hit, so the excerpt can be widened within the context budget.
  const around = found.length
    ? await db.chunks
        .where('[docId+ordinal]')
        .anyOf(found.flatMap((c) => [[c.docId, c.ordinal - 1], [c.docId, c.ordinal + 1]]))
        .toArray()
    : [];
  const at = new Map(around.map((c) => [`${c.docId}:${c.ordinal}`, c]));

  const out: Retrieved[] = [];
  ranked.forEach((r, i) => {
    const chunk = chunks[i];
    const doc = chunk && docs.get(chunk.docId);
    if (!chunk || !doc) return;
    const neighbors = [at.get(`${chunk.docId}:${chunk.ordinal - 1}`), at.get(`${chunk.docId}:${chunk.ordinal + 1}`)].filter(
      (c): c is Chunk => Boolean(c),
    );
    out.push({ chunk, doc, score: r.score, neighbors });
  });
  return out;
}

export interface RetrieveOptions {
  query: string;
  docIds: Set<string>;
  collectionIds: string[];
  embedder: Embedder | null;
  embeddingKey: string;
  chat: ChatProvider;
  settings: Settings;
  topK?: number;
  signal?: AbortSignal;
  /** Defaults to the in-browser indexes. */
  source?: CandidateSource;
}

export interface RetrieveResult {
  results: Retrieved[];
  candidates: number;
  /** Candidates the reranker judged irrelevant and left out. */
  dropped: number;
  /** The reranker that actually ran. */
  reranker: RerankMode;
  warnings: string[];
}

/**
 * Below this cross-encoder probability a passage counts as irrelevant. Deliberately low:
 * it only removes clear misses, so a question the documents don't cover gets no sources
 * instead of eight unrelated ones, while borderline passages still reach the model.
 */
export const RELEVANCE_FLOOR = 0.01;

/**
 * Hybrid retrieval: first-stage candidates (semantic + keyword, fused), reranked, stripped of
 * passages the reranker judges irrelevant, then de-duplicated down to the top k.
 */
export async function retrieve(o: RetrieveOptions): Promise<RetrieveResult> {
  const { retrieval } = o.settings;
  let reranker: RerankMode = retrieval.rerank;
  if (!o.docIds.size) return { results: [], candidates: 0, dropped: 0, reranker, warnings: [] };

  const { candidates, warnings } = await (o.source ?? localCandidates).search({
    query: o.query,
    docIds: o.docIds,
    collectionIds: o.collectionIds,
    limit: retrieval.candidates,
    embedder: o.embedder,
    embeddingKey: o.embeddingKey,
    hybrid: retrieval.hybrid,
    signal: o.signal,
  });

  let ranked = candidates;
  let dropped = 0;
  if (reranker !== 'none' && ranked.length) {
    // The local cross-encoder only reads English; other scripts go to the chat model instead.
    if (reranker === 'local' && mostlyNonLatin(o.query)) reranker = 'llm';
    try {
      ranked = await rerank(o.query, ranked, reranker, { chat: o.chat, model: o.settings.chat.fastModel, signal: o.signal });
      if (retrieval.filterIrrelevant) {
        const kept = ranked.filter((r) => r.relevance === undefined || r.relevance >= RELEVANCE_FLOOR);
        dropped = ranked.length - kept.length;
        ranked = kept;
      }
    } catch (err) {
      if (isAbort(err)) throw err;
      warnings.push(`Reranking was skipped (${errorText(err)}).`);
      reranker = 'none';
    }
  }
  return { results: selectDiverse(ranked, o.topK ?? retrieval.topK), candidates: candidates.length, dropped, reranker, warnings };
}

export async function rerank(
  query: string,
  items: Retrieved[],
  mode: RerankMode,
  ctx: { chat: ChatProvider; model: string; signal?: AbortSignal },
): Promise<Retrieved[]> {
  if (mode === 'none') return items;
  const passages = items.map((i) => `${contextTitle(i.doc.name, i.chunk.headingPath)}\n${embedText(i.chunk)}`);

  if (mode === 'local') {
    const scores = providerOverrides.reranker
      ? await providerOverrides.reranker(query, passages)
      : await localModels.rerank(LOCAL_RERANKER, query, passages, ctx.signal);
    return blendRerank(items, scores);
  }

  const numbered = passages.map((p, i) => `<passage n="${i + 1}">\n${p.slice(0, 700)}\n</passage>`).join('\n');
  const raw = await complete(ctx.chat, {
    model: ctx.model,
    system: RERANK_SYSTEM,
    messages: [{ role: 'user', content: `<query>${query}</query>\n\n${numbered}` }],
    json: true,
    effort: 'low',
    signal: ctx.signal,
  });
  const parsed = parseJsonLoose<{ ranking?: unknown }>(raw);
  if (!parsed) throw new Error('the reranker reply was not valid JSON');
  // A reply that isn't a ranking is a failed rerank, not a verdict that nothing is relevant:
  // throwing keeps every candidate (with a warning) instead of letting the filter drop them all.
  if (!Array.isArray(parsed.ranking)) throw new Error('the reranker reply had no ranking');
  const order = parsed.ranking.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length);
  if (parsed.ranking.length && !order.length) throw new Error('the reranker ranked passages that do not exist');
  const seen = new Set<number>();
  const out: Retrieved[] = [];
  for (const n of order) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push({ ...items[n - 1], score: 1 / (out.length + 1), relevance: 1 });
    }
  }
  // Passages the model left out follow in retrieval order, marked irrelevant. With filtering
  // off they stay available, so a mis-ranking can't silently remove the answer.
  items.forEach((it, i) => {
    if (!seen.has(i + 1)) out.push({ ...it, score: 0, relevance: 0 });
  });
  return out;
}

/**
 * Fuses the cross-encoder's order with the retrieval order (RRF) instead of trusting
 * the small local reranker outright: it sharpens precision, but one bad score can't
 * push the passage that actually answers the question out of the context. Each item
 * keeps its cross-encoder probability as `relevance`, for the irrelevance filter.
 */
export function blendRerank(items: Retrieved[], scores: number[]): Retrieved[] {
  const byId = new Map(items.map((it, i) => [it.chunk.id, { ...it, relevance: scores[i] }]));
  const retrievalOrder = items.map((it) => ({ id: it.chunk.id, score: it.score }));
  const rerankOrder = items.map((it, i) => ({ id: it.chunk.id, score: scores[i] })).sort((a, b) => b.score - a.score);
  return reciprocalRankFusion([retrievalOrder, rerankOrder]).map((r) => ({ ...byId.get(r.id)!, score: r.score }));
}

/** Takes the top results while skipping chunks whose text overlaps one already chosen. */
export function selectDiverse(ranked: Retrieved[], k: number): Retrieved[] {
  const chosen: Retrieved[] = [];
  for (const r of ranked) {
    if (chosen.length >= k) break;
    const overlaps = chosen.some((c) => c.doc.id === r.doc.id && c.chunk.start < r.chunk.end && r.chunk.start < c.chunk.end);
    if (!overlaps) chosen.push(r);
  }
  return chosen;
}

/** Chunks this close together (only the whitespace between them) read as one passage. */
const MERGE_GAP = 3;

/**
 * Numbers results as citable sources within the context budget. Hits go in best first; then,
 * while room remains, each hit is widened with the chunk before and after it, and chunks that
 * touch in the same document merge into one excerpt, so the model reads whole passages.
 */
export function buildSources(results: Retrieved[], budgetTokens: number): SourceRef[] {
  const hits: Retrieved[] = [];
  const rankOf = new Map<string, number>();
  const included = new Map<string, Chunk>();
  let used = 0;
  for (const r of results) {
    if (included.has(r.chunk.id)) continue;
    const tokens = estimateTokens(embedText(r.chunk));
    if (hits.length && used + tokens > budgetTokens) break;
    used += tokens;
    rankOf.set(r.chunk.id, hits.length);
    included.set(r.chunk.id, r.chunk);
    hits.push(r);
  }

  hits.forEach((r, rank) => {
    for (const n of r.neighbors ?? []) {
      if (included.has(n.id) || n.docId !== r.chunk.docId) continue;
      // Only the part not already covered by the overlap with the hit costs anything.
      const fresh = n.ordinal < r.chunk.ordinal ? n.text.slice(0, Math.max(0, r.chunk.start - n.start)) : n.text.slice(Math.max(0, r.chunk.end - n.start));
      const tokens = estimateTokens(fresh);
      if (used + tokens > budgetTokens) continue;
      used += tokens;
      rankOf.set(n.id, rank);
      included.set(n.id, n);
    }
  });

  const byDoc = new Map<string, Chunk[]>();
  for (const c of included.values()) {
    const list = byDoc.get(c.docId);
    if (list) list.push(c);
    else byDoc.set(c.docId, [c]);
  }
  const groups: { chunks: Chunk[]; rank: number }[] = [];
  const close = (chunks: Chunk[]) => groups.push({ chunks, rank: Math.min(...chunks.map((c) => rankOf.get(c.id)!)) });
  for (const list of byDoc.values()) {
    list.sort((a, b) => a.start - b.start);
    let group: Chunk[] = [];
    let end = -Infinity;
    for (const c of list) {
      if (group.length && c.start > end + MERGE_GAP) {
        close(group);
        group = [];
      }
      group.push(c);
      end = Math.max(end, c.end);
    }
    close(group);
  }
  groups.sort((a, b) => a.rank - b.rank);

  return groups.map((g, i) => {
    const hit = hits[g.rank];
    const lead = g.chunks.find((c) => c.id === hit.chunk.id) ?? g.chunks[0];
    const { text, start, end } = stitch(g.chunks);
    const source: SourceRef = {
      n: i + 1,
      chunkId: lead.id,
      docId: lead.docId,
      docName: hit.doc.name,
      headingPath: lead.headingPath,
      page: g.chunks.find((c) => c.page !== undefined)?.page,
      start,
      end,
      text,
      score: hit.score,
    };
    if (g.chunks[0].prefix) source.prefix = g.chunks[0].prefix;
    return source;
  });
}

/** Joins chunks sorted by position into one excerpt, dropping the text they overlap on. */
function stitch(chunks: Chunk[]): { text: string; start: number; end: number } {
  const start = chunks[0].start;
  let end = start;
  let text = '';
  for (const c of chunks) {
    if (c.end <= end) continue;
    if (text && c.start > end) text += '\n\n';
    text += c.text.slice(Math.max(0, end - c.start));
    end = c.end;
  }
  return { text, start, end };
}
