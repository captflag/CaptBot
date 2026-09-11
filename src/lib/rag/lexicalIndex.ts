import MiniSearch from 'minisearch';
import type { Ranked } from './fusion';

export interface LexicalDoc {
  id: string;
  docId: string;
  text: string;
  /** Document name plus heading path; matched with a lower weight than body text. */
  title: string;
}

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have how i if in into is it its of on or ' +
    'that the their then there these this to was were what when where which who why will with ' +
    'you your do does did can could should would about me my we our'
  ).split(' '),
);

function processTerm(term: string): string | null {
  const t = term.toLowerCase();
  return t.length < 2 || STOPWORDS.has(t) ? null : t;
}

/** BM25 keyword index; catches exact names, codes and numbers that embeddings blur. */
export class LexicalIndex {
  private ms = LexicalIndex.create();
  private byDoc = new Map<string, string[]>();

  private static create() {
    return new MiniSearch<LexicalDoc>({
      fields: ['text', 'title'],
      storeFields: ['docId'],
      processTerm,
      searchOptions: {
        boost: { text: 1, title: 0.6 },
        prefix: (term) => term.length > 3,
        fuzzy: (term) => (term.length > 5 ? 0.15 : false),
        combineWith: 'OR',
      },
    });
  }

  get size() {
    return this.ms.documentCount;
  }

  clear() {
    this.ms = LexicalIndex.create();
    this.byDoc.clear();
  }

  add(docs: LexicalDoc[]) {
    const fresh = docs.filter((d) => !this.ms.has(d.id));
    this.ms.addAll(fresh);
    for (const d of fresh) {
      const ids = this.byDoc.get(d.docId) ?? [];
      ids.push(d.id);
      this.byDoc.set(d.docId, ids);
    }
  }

  removeDocs(docIds: Set<string>) {
    for (const docId of docIds) {
      const ids = this.byDoc.get(docId);
      if (ids) this.ms.discardAll(ids);
      this.byDoc.delete(docId);
    }
  }

  search(query: string, k: number, allowedDocs?: Set<string> | null): Ranked[] {
    if (!query.trim() || !this.ms.documentCount) return [];
    const results = this.ms.search(query, {
      filter: allowedDocs ? (r) => allowedDocs.has(r.docId as string) : undefined,
    });
    return results.slice(0, k).map((r) => ({ id: String(r.id), score: r.score }));
  }
}
