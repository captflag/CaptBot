import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AddChunksBody,
  AppendTextBody,
  CreateDocumentBody,
  SearchBody,
  StatusResponse,
  SyncChange,
  SyncCursors,
  SyncTable,
} from '../../../api/_lib/contract';
import { profileKey, setProfileId } from '../auth/profile';
import { db, openDatabaseFor } from '../db';
import { recoverInterrupted } from '../rag/ingest';
import type { Chunk, KbDocument } from '../types';
import { adoptLocalRecords, applyPulled, hasPulled, stopSync, syncNow, syncStatus } from './engine';
import { setStorageMode } from './mode';
import { remoteOverride, type DataRemote } from './remote';
import { serverCandidates } from './serverSearch';
import { dirtyEntries, markDirty, setTracking } from './track';
import { codePoints, resumeUpload, textParts, uploadDocument } from './upload';

/** In-memory stand-in for /api/data: rows with a global sequence, tombstones, and the upload ops. */
class FakeServer implements DataRemote {
  rows = new Map<string, { table: SyncTable; id: string; row?: Record<string, unknown>; seq: number }>();
  seq = 0;
  pushes: SyncChange[][] = [];
  docs = new Map<string, { body: CreateDocumentBody; text: string; parts: number; chunks: Map<number, AddChunksBody['chunks'][number]>; complete: boolean }>();
  searches: SearchBody[] = [];

  async status(): Promise<StatusResponse> {
    return { storage: true, embedModel: 'gemini-embedding-2', dimensions: 768, embeddingKey: 'server:gemini-embedding-2:768' };
  }
  async pull(cursors: SyncCursors) {
    const changes: SyncChange[] = [];
    const next: SyncCursors = { ...cursors };
    for (const r of [...this.rows.values()].sort((a, b) => a.seq - b.seq)) {
      if (r.seq > Number((cursors[r.table] ?? '0|').split('|')[0])) {
        changes.push({ table: r.table, id: r.id, row: r.row });
        next[r.table] = `${r.seq}|${r.id}`;
      }
    }
    return { changes, cursors: next, more: false };
  }
  async push(changes: SyncChange[]) {
    this.pushes.push(changes);
    // Ids starting with "bad" stand in for records the server can't store.
    const rejected = changes.filter((c) => c.id.startsWith('bad')).map((c) => ({ table: c.table, id: c.id, error: 'Refused.' }));
    const accepted = changes.filter((c) => !c.id.startsWith('bad'));
    for (const c of accepted) this.rows.set(`${c.table}:${c.id}`, { table: c.table, id: c.id, row: c.row, seq: ++this.seq });
    return { applied: accepted.length, rejected };
  }
  async createDocument(body: CreateDocumentBody) {
    const dup = [...this.docs.values()].find((d) => d.body.hash === body.hash && d.body.id !== body.id);
    if (dup) return { duplicateOf: { ...dup.body, status: 'ready' } as unknown as Record<string, unknown> };
    if (!this.docs.has(body.id)) this.docs.set(body.id, { body, text: '', parts: 0, chunks: new Map(), complete: false });
    return {};
  }
  async appendText(b: AppendTextBody) {
    const d = this.docs.get(b.docId)!;
    if (b.index === d.parts) {
      d.text += b.text;
      d.parts++;
    }
  }
  async addChunks(b: AddChunksBody) {
    const d = this.docs.get(b.docId)!;
    for (const c of b.chunks) d.chunks.set(c.ordinal, c);
    return { stored: b.chunks.length, progress: d.chunks.size / d.body.chunkCount };
  }
  async completeDocument(docId: string) {
    const d = this.docs.get(docId)!;
    if (d.chunks.size !== d.body.chunkCount || codePoints(d.text) !== d.body.textLength) throw new Error('incomplete');
    d.complete = true;
  }
  async documentState(docId: string) {
    const d = this.docs.get(docId);
    return {
      exists: Boolean(d),
      textLength: d ? codePoints(d.text) : 0,
      expectedLength: d?.body.textLength ?? 0,
      parts: d?.parts ?? 0,
      chunkCount: d?.body.chunkCount ?? 0,
      ordinals: d ? [...d.chunks.keys()] : [],
    };
  }
  async documentText(docId: string) {
    const d = this.docs.get(docId);
    return d ? { text: d.text } : null;
  }
  async search(body: SearchBody) {
    this.searches.push(body);
    const chunk = { id: 'c1', docId: 'd1', ordinal: 1, start: 10, end: 20, text: 'refunds in 30 days', headingPath: ['Refunds'], prefix: '| h |' };
    const before = { ...chunk, id: 'c0', ordinal: 0, start: 0, end: 9, text: 'intro', prefix: undefined };
    return { hits: [{ chunk, docName: 'policy.md', score: 0.03, neighbors: [before] }], semantic: false };
  }
  async wipe() {
    this.rows.clear();
  }
}

let server: FakeServer;

/** A separate "device": its own IndexedDB database and its own sync bookkeeping. */
function device(name: string) {
  setProfileId(name);
  openDatabaseFor(name);
}

beforeEach(() => {
  stopSync(); // fresh sync status for each test
  localStorage.clear();
  server = new FakeServer();
  remoteOverride.remote = server;
  setTracking(true);
  device(`a-${Math.random().toString(36).slice(2)}`);
});

afterAll(() => {
  delete remoteOverride.remote;
  setTracking(false);
  setProfileId(null);
  openDatabaseFor(null);
});

const thread = (id: string, title: string) => ({ id, title, collectionIds: [], createdAt: 1, updatedAt: 2 });

describe('change tracking', () => {
  it('queues local writes only while server storage is on', async () => {
    setTracking(false);
    await db.threads.add(thread('t0', 'Offline only'));
    expect(dirtyEntries()).toEqual([]);

    setTracking(true);
    await db.threads.add(thread('t1', 'Hello'));
    await db.threads.update('t1', { title: 'Hello again' });
    await db.messages.where('threadId').equals('nothing').delete();
    expect(dirtyEntries().map((e) => `${e.table}:${e.id}`)).toEqual(['threads:t1']);
  });

  it('pushes queued writes and clears the queue', async () => {
    await db.threads.add(thread('t1', 'Hello'));
    await db.prompts.add({ id: 'p1', text: 'Summarise', createdAt: 1 });
    await syncNow();
    expect(server.rows.get('threads:t1')?.row).toMatchObject({ title: 'Hello' });
    expect(server.rows.get('prompts:p1')?.row).toMatchObject({ text: 'Summarise' });
    expect(dirtyEntries()).toEqual([]);
  });

  it('does not push a write that happened after the record was read for a push', async () => {
    await db.threads.add(thread('t1', 'First'));
    const [entry] = dirtyEntries();
    markDirty('threads', ['t1']); // edited again mid-push
    const { clearDirty } = await import('./track');
    clearDirty([entry]);
    expect(dirtyEntries()).toHaveLength(1);
  });
});

describe('two devices', () => {
  it('syncs writes, keeps image data on the sending device, and never echoes pulled rows', async () => {
    await db.threads.add(thread('t1', 'Trip plan'));
    await db.messages.add({
      id: 'm1',
      threadId: 't1',
      role: 'user',
      content: 'What is this?',
      createdAt: 3,
      images: [{ name: 'photo.png', mimeType: 'image/png', data: 'AAAA' }],
    });
    await syncNow();
    expect((server.rows.get('messages:m1')?.row as { images: { data: string }[] }).images[0].data).toBe('');
    expect((await db.messages.get('m1'))!.images![0].data).toBe('AAAA');

    device('b');
    await syncNow();
    expect(await db.threads.get('t1')).toMatchObject({ title: 'Trip plan' });
    expect((await db.messages.get('m1'))!.images![0]).toMatchObject({ name: 'photo.png', data: '' });
    expect(dirtyEntries()).toEqual([]);
    expect(server.pushes).toHaveLength(1);
  });

  it('propagates deletes', async () => {
    await db.threads.add(thread('t1', 'Old'));
    await syncNow();
    const first = db.name;

    device('b');
    await syncNow();
    await db.threads.delete('t1');
    await syncNow();
    expect(server.rows.get('threads:t1')?.row).toBeUndefined();

    device(first.replace('captbot-', ''));
    await syncNow();
    expect(await db.threads.get('t1')).toBeUndefined();
  });

  it('lets an edit that has not been pushed yet win over a pulled change', async () => {
    await db.threads.add(thread('t1', 'Mine'));
    await applyPulled([{ table: 'threads', id: 't1', row: thread('t1', 'Theirs') }]);
    expect((await db.threads.get('t1'))!.title).toBe('Mine');
  });

  it("keeps this device's image data when the synced copy has none", async () => {
    setTracking(false);
    await db.messages.add({ id: 'm1', threadId: 't', role: 'user', content: 'x', createdAt: 1, images: [{ name: 'a.png', mimeType: 'image/png', data: 'BBBB' }] });
    setTracking(true);
    await applyPulled([{ table: 'messages', id: 'm1', row: { id: 'm1', threadId: 't', role: 'user', content: 'x (edited)', createdAt: 1, images: [{ name: 'a.png', mimeType: 'image/png', data: '' }] } }]);
    const m = (await db.messages.get('m1'))!;
    expect(m.content).toBe('x (edited)');
    expect(m.images![0].data).toBe('BBBB');
  });

  it('removes a deleted document together with its cached text and chunks', async () => {
    setTracking(false);
    await db.docTexts.put({ docId: 'd1', text: 'hello' });
    await db.chunks.put({ id: 'c1', docId: 'd1', ordinal: 0, start: 0, end: 5, text: 'hello', headingPath: [] });
    setTracking(true);
    await applyPulled([{ table: 'documents', id: 'd1' }]);
    expect(await db.docTexts.get('d1')).toBeUndefined();
    expect(await db.chunks.count()).toBe(0);
  });
});

describe('when things go wrong', () => {
  const KEY = 'server:gemini-embedding-2:768';

  it('reports a change the server refuses and keeps syncing the rest', async () => {
    await db.threads.bulkAdd([thread('bad1', 'Unstorable'), thread('t1', 'Fine')]);
    await syncNow();
    expect(server.rows.has('threads:t1')).toBe(true);
    expect(server.rows.has('threads:bad1')).toBe(false);
    expect(dirtyEntries()).toEqual([]);
    expect(syncStatus()).toMatchObject({ phase: 'idle', rejected: 1, rejection: 'Refused.' });
  });

  it("still pulls other devices' changes when pushing fails", async () => {
    await db.threads.add(thread('t1', 'From device A'));
    await syncNow();

    device('b');
    server.push = async () => {
      throw new Error('push failed');
    };
    await db.threads.add(thread('t2', 'Waiting on B'));
    await syncNow();
    expect(await db.threads.get('t1')).toMatchObject({ title: 'From device A' });
    expect(dirtyEntries().map((e) => e.id)).toEqual(['t2']);
    expect(syncStatus()).toMatchObject({ phase: 'error', error: 'push failed' });
  });

  it('abandons a sync that outlives its account', async () => {
    server.rows.set('threads:t9', { table: 'threads', id: 't9', row: thread('t9', 'Late'), seq: ++server.seq });
    const run = syncNow();
    stopSync(); // signed out mid-sync
    await run;
    expect(await db.threads.get('t9')).toBeUndefined();
    expect(hasPulled()).toBe(false);
  });

  it("queues only this browser's own data when an account is first adopted", async () => {
    server.rows.set('threads:r1', { table: 'threads', id: 'r1', row: thread('r1', 'From the account'), seq: ++server.seq });
    setTracking(false);
    await db.threads.add(thread('l1', 'Made here'));
    setTracking(true);

    await adoptLocalRecords(KEY);
    await syncNow();
    expect(server.pushes.flat().map((c) => c.id)).toEqual(['l1']);
    expect(await db.threads.get('r1')).toMatchObject({ title: 'From the account' });

    await adoptLocalRecords(KEY); // once only
    expect(dirtyEntries()).toEqual([]);
  });

  it('removes NUL characters before pushing', async () => {
    await db.prompts.add({ id: 'p1', text: 'a b', createdAt: 1 });
    await syncNow();
    expect(server.rows.get('prompts:p1')?.row).toMatchObject({ text: 'ab' });
  });

  it("marks only this browser's interrupted uploads as failed", async () => {
    const pending = (id: string): KbDocument => ({
      id,
      name: `${id}.md`,
      sourceType: 'text',
      mimeType: 'text/plain',
      hash: id,
      collectionIds: [],
      charCount: 1,
      chunkCount: 1,
      status: 'embedding',
      progress: 0.5,
      createdAt: 1,
      updatedAt: 1,
    });
    setStorageMode({ server: true, embeddingKey: KEY });
    try {
      setTracking(false);
      await db.documents.bulkAdd([pending('elsewhere'), pending('mine')]);
      await db.docTexts.put({ docId: 'mine', text: 'x' });
      setTracking(true);
      localStorage.setItem(profileKey('captbot_ingesting'), JSON.stringify(['mine']));

      await recoverInterrupted();
      expect((await db.documents.get('elsewhere'))!.status).toBe('embedding'); // another device's upload
      expect((await db.documents.get('mine'))!.status).toBe('error');
    } finally {
      setStorageMode({ server: false, embeddingKey: null });
    }
  });
});

describe('upload', () => {
  const doc = (id: string, hash = `h-${id}`): KbDocument => ({
    id,
    name: `${id}.md`,
    sourceType: 'text',
    mimeType: 'text/plain',
    hash,
    collectionIds: [],
    charCount: 0,
    chunkCount: 0,
    status: 'embedding',
    progress: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  const chunks = (docId: string, n: number): Chunk[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${docId}-c${i}`, docId, ordinal: i, start: i, end: i + 1, text: `chunk ${i}`, headingPath: [] }));

  it('sends the text in parts and the chunks in batches, then completes', async () => {
    const text = 'a'.repeat(25);
    const progress: number[] = [];
    const result = await uploadDocument({ doc: doc('d1'), text, chunks: chunks('d1', 100), onProgress: (p) => progress.push(p) });
    expect(result).toEqual({ status: 'done' });
    const stored = server.docs.get('d1')!;
    expect(stored).toMatchObject({ text, complete: true });
    expect(stored.chunks.size).toBe(100);
    expect(progress).toEqual([0.48, 0.96, 1]);
  });

  it('returns the account copy of a document with the same text', async () => {
    await uploadDocument({ doc: doc('d1', 'same'), text: 'x', chunks: chunks('d1', 1) });
    const result = await uploadDocument({ doc: doc('d2', 'same'), text: 'x', chunks: chunks('d2', 1) });
    expect(result.status).toBe('duplicate');
    expect(result.status === 'duplicate' && result.existing.id).toBe('d1');
  });

  it('resumes an interrupted upload with only the missing chunks', async () => {
    const all = chunks('d1', 60);
    await server.createDocument({ id: 'd1', name: 'd1.md', sourceType: 'text', mimeType: '', hash: 'h', collectionIds: [], charCount: 5, textLength: 5, chunkCount: 60, createdAt: 1 });
    await server.appendText({ docId: 'd1', index: 0, text: 'hello' });
    await server.addChunks({ docId: 'd1', chunks: all.slice(0, 48) });
    const sent: number[] = [];
    const original = server.addChunks.bind(server);
    server.addChunks = async (b) => {
      sent.push(...b.chunks.map((c) => c.ordinal));
      return original(b);
    };
    expect(await resumeUpload({ doc: doc('d1'), text: 'hello', chunks: all })).toEqual({ status: 'done' });
    expect(sent).toEqual(Array.from({ length: 12 }, (_, i) => 48 + i));
    expect(server.docs.get('d1')!.complete).toBe(true);
  });

  it('stops quietly when the document is removed mid-upload', async () => {
    const result = await uploadDocument({ doc: doc('d1'), text: 'x', chunks: chunks('d1', 100), cancelled: async () => true });
    expect(result).toEqual({ status: 'cancelled' });
    expect(server.docs.get('d1')!.complete).toBe(false);
  });

  it('counts code points like Postgres and never splits a surrogate pair', () => {
    expect(codePoints('a😀b')).toBe(3);
    const parts = textParts('ab😀cd', 3);
    expect(parts.join('')).toBe('ab😀cd');
    expect(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
  });
});

describe('server search', () => {
  it('maps hits to candidates with their neighbours, and reports keyword-only fallback', async () => {
    const res = await serverCandidates.search({
      query: 'refund window',
      docIds: new Set(['d1']),
      collectionIds: ['col'],
      limit: 80,
      embedder: null,
      embeddingKey: '',
      hybrid: true,
    });
    expect(server.searches[0]).toEqual({ query: 'refund window', collectionIds: ['col'], limit: 50 });
    expect(res.candidates[0]).toMatchObject({ doc: { id: 'd1', name: 'policy.md' }, chunk: { id: 'c1', prefix: '| h |' }, score: 0.03 });
    expect(res.candidates[0].neighbors!.map((n) => n.id)).toEqual(['c0']);
    expect(res.candidates[0].neighbors![0]).not.toHaveProperty('prefix');
    expect(res.warnings.join(' ')).toMatch(/keyword search/);
  });
});
