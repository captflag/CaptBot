// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  AddChunksResponse,
  AppendTextBody,
  CreateDocumentBody,
  DocumentStateResponse,
  EmbedBody,
  PullResponse,
  RateLimitedBody,
  SearchChunk,
  SearchResponse,
  SyncChange,
  SyncCursors,
} from './contract.js';
import { createDataHandler, STORAGE_EMBEDDING_KEY } from './data.js';
import type { DataStore, RankedChunk, SearchParams, StoredChunk } from './datastore.js';
import { toTsQuery } from './embedFormat.js';
import type { ApiDeps } from './handlers.js';
import { memoryLimiter } from './limits.js';

/** In-memory stand-in for Postgres that records which user every call was scoped to. */
class FakeStore implements DataStore {
  users: string[] = [];
  docs = new Map<
    string,
    { name: string; status: string; hash: string; collectionIds: string[]; chunkCount: number; text: string; expected: number; parts: number }
  >();
  chunks: StoredChunk[] = [];
  searches: SearchParams[] = [];
  pushed: SyncChange[] = [];

  private seen(userId: string) {
    this.users.push(userId);
  }
  async pull(userId: string, cursors: SyncCursors): Promise<PullResponse> {
    this.seen(userId);
    return { changes: [], cursors, more: false };
  }
  async push(userId: string, changes: SyncChange[]) {
    this.seen(userId);
    this.pushed.push(...changes);
    return { applied: changes.length, rejected: [] };
  }
  async createDocument(userId: string, b: CreateDocumentBody) {
    this.seen(userId);
    const dup = [...this.docs.entries()].find(([, d]) => d.hash === b.hash);
    if (dup) return { duplicateOf: { id: dup[0], name: dup[1].name } };
    this.docs.set(b.id, {
      name: b.name,
      status: 'embedding',
      hash: b.hash,
      collectionIds: b.collectionIds,
      chunkCount: b.chunkCount,
      text: '',
      expected: b.textLength,
      parts: 0,
    });
    return {};
  }
  async appendText(userId: string, b: AppendTextBody) {
    this.seen(userId);
    const d = this.docs.get(b.docId)!;
    if (d.parts === b.index) {
      d.text += b.text;
      d.parts++;
    }
  }
  async documentName(userId: string, docId: string) {
    this.seen(userId);
    return this.docs.get(docId)?.name ?? null;
  }
  async addChunks(userId: string, docId: string, chunks: StoredChunk[]): Promise<AddChunksResponse> {
    this.seen(userId);
    this.chunks.push(...chunks.map((c) => ({ ...c, docId })));
    return { stored: chunks.length, progress: this.chunks.length / this.docs.get(docId)!.chunkCount };
  }
  async completeDocument(userId: string, docId: string, embeddingKey: string) {
    this.seen(userId);
    const d = this.docs.get(docId)!;
    d.status = `ready:${embeddingKey}`;
  }
  async documentState(userId: string, docId: string): Promise<DocumentStateResponse> {
    this.seen(userId);
    const d = this.docs.get(docId);
    return {
      exists: Boolean(d),
      textLength: d?.text.length ?? 0,
      expectedLength: d?.expected ?? 0,
      parts: d?.parts ?? 0,
      chunkCount: d?.chunkCount ?? 0,
      ordinals: [],
    };
  }
  async documentText(userId: string, docId: string) {
    this.seen(userId);
    const d = this.docs.get(docId);
    return d ? { text: d.text } : null;
  }
  async scope(userId: string) {
    this.seen(userId);
    return [...this.docs.entries()].filter(([, d]) => d.status.startsWith('ready')).map(([id, d]) => ({ id, name: d.name }));
  }
  async search(userId: string, params: SearchParams): Promise<RankedChunk[]> {
    this.seen(userId);
    this.searches.push(params);
    return this.chunks
      .filter((c) => params.docIds.includes((c as StoredChunk & { docId: string }).docId))
      .slice(0, 1)
      .map((c) => ({ chunk: this.asSearchChunk(c), score: 0.03 }));
  }
  async neighbors(userId: string, positions: { docId: string; ordinal: number }[]): Promise<SearchChunk[]> {
    this.seen(userId);
    return this.chunks.map((c) => this.asSearchChunk(c)).filter((c) => positions.some((p) => p.docId === c.docId && p.ordinal === c.ordinal));
  }
  async wipe(userId: string) {
    this.seen(userId);
    this.docs.clear();
  }
  private asSearchChunk(c: StoredChunk): SearchChunk {
    const { title: _title, embedding: _embedding, ...rest } = c as StoredChunk & { docId: string };
    return rest as SearchChunk;
  }
}

const limits = {
  chat: { perMinute: 5, perDay: 5 },
  embed: { perMinute: 3, perDay: 3 },
  search: { perMinute: 2, perDay: 10 },
  write: { perMinute: 4, perDay: 10 },
};

function setup(overrides: Partial<ApiDeps> = {}) {
  const store = new FakeStore();
  const embedded: EmbedBody[] = [];
  const deps: ApiDeps = {
    authenticate: async (req) => (req.headers.get('authorization') === 'Bearer good' ? 'user_1' : null),
    limiter: memoryLimiter(limits),
    chat: {
      async *stream() {
        yield { text: '' };
      },
    },
    embed: {
      async embed(body) {
        embedded.push(body);
        return body.texts.map(() => new Array(768).fill(0.1));
      },
    },
    store,
    ...overrides,
  };
  const handler = createDataHandler(deps);
  const call = (op: string, body: unknown, token = 'good') =>
    handler(
      new Request(`http://localhost/api/data?op=${op}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  return { store, embedded, deps, call };
}

const DOC: CreateDocumentBody = {
  id: 'doc1',
  name: 'policy.md',
  sourceType: 'text',
  mimeType: 'text/plain',
  hash: 'h1',
  collectionIds: [],
  charCount: 23,
  textLength: 23,
  chunkCount: 2,
  createdAt: 1,
};

const chunk = (ordinal: number, text: string, extra: Record<string, unknown> = {}) => ({
  id: `c${ordinal}`,
  ordinal,
  start: ordinal * 12,
  end: ordinal * 12 + text.length,
  text,
  headingPath: ['Refunds'],
  ...extra,
});

async function indexDocument(call: ReturnType<typeof setup>['call']) {
  await call('create-document', DOC);
  await call('append-text', { docId: 'doc1', index: 0, text: 'Refunds in 30 days. Yes.' });
  await call('add-chunks', { docId: 'doc1', chunks: [chunk(0, 'Refunds in 30 days.'), chunk(1, 'Yes.', { prefix: '| a |' })] });
  await call('complete-document', { docId: 'doc1' });
}

describe('POST /api/data', () => {
  it('requires a session', async () => {
    const res = await setup().call('status', {}, 'bad');
    expect(res.status).toBe(401);
  });

  it('reports storage as unavailable without a database', async () => {
    const res = await setup({ store: null }).call('status', {});
    expect(res.status).toBe(503);
  });

  it('reports the vector space it indexes with', async () => {
    const res = await setup().call('status', {});
    expect(await res.json()).toMatchObject({ storage: true, dimensions: 768, embeddingKey: STORAGE_EMBEDDING_KEY });
  });

  it('rejects unknown ops and non-POST requests', async () => {
    expect((await setup().call('drop-tables', {})).status).toBe(400);
    const res = await createDataHandler(setup().deps)(new Request('http://localhost/api/data?op=status'));
    expect(res.status).toBe(405);
  });

  it('indexes a document: embeds each chunk with its context title and prefix, then marks it ready', async () => {
    const { call, store, embedded } = setup();
    await indexDocument(call);

    expect(embedded).toHaveLength(1);
    expect(embedded[0]).toMatchObject({ model: 'gemini-embedding-2', dimensions: 768 });
    expect(embedded[0].texts).toEqual(['title: policy.md › Refunds | text: Refunds in 30 days.', 'title: policy.md › Refunds | text: | a |\nYes.']);
    expect(store.chunks.map((c) => c.title)).toEqual(['policy.md › Refunds', 'policy.md › Refunds']);
    expect(store.docs.get('doc1')!.status).toBe(`ready:${STORAGE_EMBEDDING_KEY}`);
  });

  it('counts each chunk batch against the indexing allowance', async () => {
    const { call } = setup();
    await call('create-document', DOC);
    const res = await call('add-chunks', { docId: 'doc1', chunks: [chunk(0, 'a')] });
    expect(res.headers.get('x-ratelimit-remaining')).toBe('2');
    await call('add-chunks', { docId: 'doc1', chunks: [chunk(0, 'a')] });
    await call('add-chunks', { docId: 'doc1', chunks: [chunk(0, 'a')] });
    const limited = await call('add-chunks', { docId: 'doc1', chunks: [chunk(0, 'a')] });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as RateLimitedBody).scope).toBe('embed');
  });

  it('validates chunk batches before spending any allowance', async () => {
    const { call, deps, embedded } = setup();
    await call('create-document', DOC);
    const tooMany = await call('add-chunks', { docId: 'doc1', chunks: Array.from({ length: 65 }, (_, i) => chunk(i, 'x')) });
    expect(tooMany.status).toBe(400);
    const unknownDoc = await call('add-chunks', { docId: 'nope', chunks: [chunk(0, 'x')] });
    expect(unknownDoc.status).toBe(404);
    expect(embedded).toHaveLength(0);
    expect((await deps.limiter.peek('user_1', 'embed')).remaining).toBe(3);
  });

  it('returns the existing document when the same text is uploaded again', async () => {
    const { call } = setup();
    await call('create-document', DOC);
    const res = await call('create-document', { ...DOC, id: 'doc2' });
    expect(await res.json()).toEqual({ duplicateOf: { id: 'doc1', name: 'policy.md' } });
  });

  it('searches with the embedded question and keywords, and attaches document names and neighbours', async () => {
    const { call, store, embedded } = setup();
    await indexDocument(call);
    embedded.length = 0;

    const res = await call('search', { query: 'What is the refund window?', collectionIds: [], limit: 10 });
    const body = (await res.json()) as SearchResponse;
    expect(body.semantic).toBe(true);
    expect(embedded[0].texts).toEqual(['task: search result | query: What is the refund window?']);
    expect(store.searches[0]).toMatchObject({ docIds: ['doc1'], tsquery: 'refund:* | window:*', limit: 10 });
    expect(store.searches[0].vector).toHaveLength(768);
    expect(body.hits[0]).toMatchObject({ docName: 'policy.md', chunk: { id: 'c0', text: 'Refunds in 30 days.' } });
    expect(body.hits[0].neighbors.map((n) => n.id)).toEqual(['c1']);
    expect(res.headers.get('x-ratelimit-limit')).toBe('10');
  });

  it('falls back to keyword search when the question cannot be embedded', async () => {
    const { call, store, deps } = setup();
    await indexDocument(call);
    deps.embed.embed = async () => {
      throw new Error('quota');
    };
    const body = (await (await call('search', { query: 'refund', collectionIds: [], limit: 5 })).json()) as SearchResponse;
    expect(body.semantic).toBe(false);
    expect(store.searches[0].vector).toBeNull();
    expect(body.hits).toHaveLength(1);
  });

  it('skips embedding when nothing is in scope', async () => {
    const { call, embedded } = setup();
    const body = (await (await call('search', { query: 'refund', collectionIds: [], limit: 5 })).json()) as SearchResponse;
    expect(body.hits).toEqual([]);
    expect(embedded).toHaveLength(0);
  });

  it('rate limits searches separately', async () => {
    const { call } = setup();
    await call('search', { query: 'a b', collectionIds: [], limit: 5 });
    await call('search', { query: 'a b', collectionIds: [], limit: 5 });
    const res = await call('search', { query: 'a b', collectionIds: [], limit: 5 });
    expect(res.status).toBe(429);
    expect(((await res.json()) as RateLimitedBody).scope).toBe('search');
  });

  it('validates pushes', async () => {
    const { call, store } = setup();
    expect((await call('push', { changes: [{ table: 'users', id: 'x' }] })).status).toBe(400);
    expect((await call('push', { changes: new Array(201).fill({ table: 'threads', id: 'x' }) })).status).toBe(400);
    const ok = await call('push', {
      changes: [
        { table: 'threads', id: 't1', row: { title: 'Hi' } },
        { table: 'prompts', id: 'p1' },
      ],
    });
    expect(await ok.json()).toEqual({ applied: 2, rejected: [] });
    expect(store.pushed[1]).toEqual({ table: 'prompts', id: 'p1', row: undefined });
  });

  it('counts saves against the write allowance', async () => {
    const { call } = setup();
    for (let i = 0; i < 4; i++) expect((await call('push', { changes: [{ table: 'prompts', id: `p${i}` }] })).status).toBe(200);
    const res = await call('push', { changes: [{ table: 'prompts', id: 'p9' }] });
    expect(res.status).toBe(429);
    expect(((await res.json()) as RateLimitedBody).scope).toBe('write');
    // Uploads draw on the same allowance.
    expect((await call('create-document', DOC)).status).toBe(429);
  });

  it('rejects documents over the size limit and text the database cannot store', async () => {
    const { call } = setup();
    expect((await call('create-document', { ...DOC, textLength: 20_000_001 })).status).toBe(400);
    await call('create-document', DOC);
    expect((await call('append-text', { docId: 'doc1', index: 0, text: 'a b' })).status).toBe(400);
    expect((await call('add-chunks', { docId: 'doc1', chunks: [chunk(0, 'a b')] })).status).toBe(400);
  });

  it('scopes every call to the session user, whatever the body says', async () => {
    const { call, store } = setup();
    await call('pull', { cursors: {}, userId: 'someone_else' });
    await call('document-state', { docId: 'doc1', userId: 'someone_else' });
    expect(new Set(store.users)).toEqual(new Set(['user_1']));
  });
});

describe('toTsQuery', () => {
  it('ORs content words, prefix-matching longer ones', () => {
    expect(toTsQuery('What is the refund window?')).toBe('refund:* | window:*');
  });

  it('keeps identifiers and numbers but never tsquery syntax', () => {
    expect(toTsQuery("INV-2291 & (Q3's) !report | x")).toBe('inv | 2291:* | q3 | report:*');
  });

  it('returns nothing for a query of stopwords and punctuation', () => {
    expect(toTsQuery('what is it?!')).toBe('');
  });
});
