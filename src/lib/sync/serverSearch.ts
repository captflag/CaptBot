import type { SearchChunk } from '../../../api/_lib/contract';
import type { CandidateSource, Retrieved } from '../rag/retrieve';
import type { Chunk } from '../types';
import { remote } from './remote';

function toChunk(c: SearchChunk): Chunk {
  const chunk: Chunk = {
    id: c.id,
    docId: c.docId,
    ordinal: c.ordinal,
    start: c.start,
    end: c.end,
    text: c.text,
    headingPath: c.headingPath,
    page: c.page,
    pageEnd: c.pageEnd,
  };
  if (c.prefix) chunk.prefix = c.prefix;
  return chunk;
}

/**
 * First-stage candidates from the account index on the server: pgvector and Postgres full-text
 * search fused with RRF, each hit with its neighbouring chunks. Reranking and the relevance
 * filter still run in the browser, exactly as for the local index.
 */
export const serverCandidates: CandidateSource = {
  async search(req) {
    const res = await remote().search({ query: req.query, collectionIds: req.collectionIds, limit: Math.min(50, req.limit) }, req.signal);
    const candidates: Retrieved[] = res.hits.map((h) => ({
      chunk: toChunk(h.chunk),
      doc: { id: h.chunk.docId, name: h.docName },
      score: h.score,
      neighbors: h.neighbors.map(toChunk),
    }));
    return { candidates, warnings: res.semantic ? [] : ['Semantic search was unavailable on the server, so keyword search was used.'] };
  },
};
