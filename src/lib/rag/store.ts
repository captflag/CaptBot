import { db } from '../db';
import type { Chunk, ChunkVector, KbDocument } from '../types';
import type { Ranked } from './fusion';
import { LexicalIndex, type LexicalDoc } from './lexicalIndex';
import { VectorIndex } from './vectorIndex';

// Tells other open tabs to reload their in-memory indexes after this tab changes the knowledge base.
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('captbot-knowledge');
(channel as { unref?: () => void } | null)?.unref?.(); // don't keep Node (tests) alive

/** "report.pdf › Methods › Sampling": prepended to chunks for embedding and keyword title matching. */
export function contextTitle(docName: string, headingPath: string[]): string {
  return [docName, ...headingPath].join(' › ');
}

/** What gets embedded and keyword-indexed for a chunk: its text, after any prefix (a split table's header). */
export function embedText(chunk: Pick<Chunk, 'text' | 'prefix'>): string {
  return chunk.prefix ? `${chunk.prefix}\n${chunk.text}` : chunk.text;
}

function toLexical(chunk: Chunk, docName: string): LexicalDoc {
  return { id: chunk.id, docId: chunk.docId, text: embedText(chunk), title: contextTitle(docName, chunk.headingPath) };
}

/**
 * In-memory search indexes mirrored from IndexedDB. The keyword index covers
 * every chunk; the vector index holds only vectors for the active embedding
 * model, since vectors from different models live in different spaces.
 */
class KnowledgeStore {
  private lexical = new LexicalIndex();
  private vectors = new VectorIndex();
  private lexicalReady = false;
  private vectorKey: string | null = null;
  private loading: Promise<void> | null = null;

  constructor() {
    channel?.addEventListener('message', () => this.reset());
  }

  async ensureLoaded(embeddingKey: string): Promise<void> {
    while (!this.lexicalReady || this.vectorKey !== embeddingKey) {
      this.loading ??= this.load(embeddingKey).finally(() => {
        this.loading = null;
      });
      await this.loading;
    }
  }

  private async load(embeddingKey: string) {
    if (!this.lexicalReady) {
      const [docs, chunks] = await Promise.all([db.documents.toArray(), db.chunks.toArray()]);
      const names = new Map(docs.map((d) => [d.id, d.name]));
      this.lexical.clear();
      this.lexical.add(chunks.map((c) => toLexical(c, names.get(c.docId) ?? '')));
      this.lexicalReady = true;
    }
    if (this.vectorKey !== embeddingKey) {
      const rows = await db.vectors.where('embeddingKey').equals(embeddingKey).toArray();
      this.vectors.clear();
      this.vectors.add(rows.map((r) => ({ id: r.chunkId, docId: r.docId, vector: r.vector })));
      this.vectorKey = embeddingKey;
    }
  }

  get vectorCount() {
    return this.vectors.size;
  }

  /** Mirrors a freshly (re-)indexed document into loaded indexes. */
  addDocument(doc: KbDocument, chunks: Chunk[], vectors: ChunkVector[]) {
    if (this.lexicalReady) this.lexical.add(chunks.map((c) => toLexical(c, doc.name)));
    if (this.vectorKey) {
      this.vectors.removeDocs(new Set([doc.id]));
      this.vectors.add(vectors.filter((v) => v.embeddingKey === this.vectorKey).map((v) => ({ id: v.chunkId, docId: v.docId, vector: v.vector })));
    }
    channel?.postMessage('changed');
  }

  removeDocuments(ids: string[]) {
    const set = new Set(ids);
    this.lexical.removeDocs(set);
    this.vectors.removeDocs(set);
    channel?.postMessage('changed');
  }

  /** Drops the in-memory indexes (here and in other tabs); the next search reloads from IndexedDB. */
  invalidate() {
    this.reset();
    channel?.postMessage('changed');
  }

  private reset() {
    this.lexical.clear();
    this.vectors.clear();
    this.lexicalReady = false;
    this.vectorKey = null;
  }

  lexicalSearch(query: string, k: number, allowedDocs: Set<string>): Ranked[] {
    return this.lexical.search(query, k, allowedDocs);
  }

  vectorSearch(query: Float32Array, k: number, allowedDocs: Set<string>): Ranked[] {
    return this.vectors.search(query, k, allowedDocs);
  }
}

export const knowledge = new KnowledgeStore();

export async function deleteDocuments(ids: string[]) {
  await db.transaction('rw', [db.documents, db.docTexts, db.chunks, db.vectors], async () => {
    await db.documents.bulkDelete(ids);
    await db.docTexts.bulkDelete(ids);
    await db.chunks.where('docId').anyOf(ids).delete();
    await db.vectors.where('docId').anyOf(ids).delete();
  });
  knowledge.removeDocuments(ids);
}
