import type { Ranked } from './fusion';

export interface VectorEntry {
  id: string;
  docId: string;
  vector: Float32Array;
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0 || Math.abs(norm - 1) < 1e-6) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * In-memory exact-search vector index over unit vectors, stored as one flat
 * Float32Array. Brute force is fast enough for personal knowledge bases
 * (tens of thousands of chunks) and gives exact results.
 */
export class VectorIndex {
  private dims = 0;
  private data = new Float32Array(0);
  private ids: string[] = [];
  private docIds: string[] = [];

  get size() {
    return this.ids.length;
  }

  get dimensions() {
    return this.dims;
  }

  clear() {
    this.dims = 0;
    this.data = new Float32Array(0);
    this.ids = [];
    this.docIds = [];
  }

  add(entries: VectorEntry[]) {
    if (!entries.length) return;
    if (!this.dims) this.dims = entries[0].vector.length;
    const needed = (this.ids.length + entries.length) * this.dims;
    if (needed > this.data.length) {
      const grown = new Float32Array(Math.max(needed, this.data.length * 2));
      grown.set(this.data);
      this.data = grown;
    }
    for (const e of entries) {
      if (e.vector.length !== this.dims) {
        throw new Error(`Vector dimension mismatch: index has ${this.dims}, got ${e.vector.length}`);
      }
      this.data.set(normalize(e.vector), this.ids.length * this.dims);
      this.ids.push(e.id);
      this.docIds.push(e.docId);
    }
  }

  removeDocs(docIds: Set<string>) {
    let write = 0;
    for (let read = 0; read < this.ids.length; read++) {
      if (docIds.has(this.docIds[read])) continue;
      if (write !== read) {
        this.data.copyWithin(write * this.dims, read * this.dims, (read + 1) * this.dims);
        this.ids[write] = this.ids[read];
        this.docIds[write] = this.docIds[read];
      }
      write++;
    }
    this.ids.length = write;
    this.docIds.length = write;
  }

  search(query: Float32Array, k: number, allowedDocs?: Set<string> | null): Ranked[] {
    if (!this.ids.length || k <= 0) return [];
    if (query.length !== this.dims) {
      throw new Error(`Query has ${query.length} dimensions but the index has ${this.dims}. Re-index your documents.`);
    }
    const q = normalize(query);
    const top: { i: number; s: number }[] = [];
    const d = this.dims;
    for (let row = 0; row < this.ids.length; row++) {
      if (allowedDocs && !allowedDocs.has(this.docIds[row])) continue;
      let s = 0;
      const base = row * d;
      for (let j = 0; j < d; j++) s += q[j] * this.data[base + j];
      if (top.length < k) {
        insertSorted(top, { i: row, s });
      } else if (s > top[top.length - 1].s) {
        top.pop();
        insertSorted(top, { i: row, s });
      }
    }
    return top.map(({ i, s }) => ({ id: this.ids[i], score: s }));
  }
}

function insertSorted(arr: { i: number; s: number }[], item: { i: number; s: number }) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].s >= item.s) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, item);
}
