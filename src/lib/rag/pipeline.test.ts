import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCollection, db } from '../db';
import { applyPack, buildPack, decodePack, encodePack } from '../kb/transfer';
import { GAP_SYSTEM } from '../prompts';
import { providerOverrides } from '../providers';
import type { ChatProvider, ChatRequest, EmbedInput, Embedder } from '../providers/types';
import { getSettings, updateSettings } from '../settings';
import { answer, type AnswerEvent } from './answer';
import { ingest, recoverInterrupted } from './ingest';
import { knowledge } from './store';

/** Deterministic bag-of-words embedder so retrieval quality is testable offline. */
class HashEmbedder implements Embedder {
  readonly key = 'test:hash:256';
  readonly batchSize = 4;
  calls = 0;
  private vec(text: string) {
    const v = new Float32Array(256);
    for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      let h = 7;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % 256] += 1;
    }
    return v;
  }
  async embedDocuments(docs: EmbedInput[]) {
    this.calls++;
    return docs.map((d) => this.vec(d.text));
  }
  async embedQuery(q: string) {
    return this.vec(q);
  }
}

class FakeChat implements ChatProvider {
  readonly id = 'gemini' as const;
  readonly supportsWebSearch = false;
  requests: ChatRequest[] = [];
  async *stream(req: ChatRequest) {
    this.requests.push(req);
    if (req.system === GAP_SYSTEM) {
      // One real gap, plus a query that already ran (which must not be searched twice).
      yield { text: '{"queries": ["panel cleaning and maintenance", "Solar panel efficiency"]}' };
      return;
    }
    if (req.json) {
      yield { text: '{"queries": ["solar panel efficiency", "wind turbine output"]}' };
      return;
    }
    yield { text: 'Solar panels convert sunlight ' };
    yield { text: 'into electricity [1].' };
  }
}

const SOLAR = `# Solar power\n\nSolar panels convert sunlight into electricity using photovoltaic cells. Panel efficiency typically ranges from fifteen to twenty two percent.\n\n## Maintenance\n\nPanels need occasional cleaning to remove dust.`;
const WIND = `# Wind power\n\nWind turbines convert kinetic energy from moving air into electricity. Turbine output depends on wind speed cubed.`;
const BAKING = `# Sourdough\n\nSourdough bread rises using a wild yeast starter instead of commercial yeast.`;

const embedder = new HashEmbedder();
const chat = new FakeChat();

async function collect(gen: AsyncGenerator<AnswerEvent>) {
  const events: AnswerEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

beforeEach(async () => {
  providerOverrides.embedder = embedder;
  providerOverrides.chat = chat;
  chat.requests = [];
  updateSettings({ retrieval: { ...getSettings().retrieval, rerank: 'none', topK: 3 } });
  await Promise.all(db.tables.map((t) => t.clear()));
  knowledge.invalidate();
});

afterAll(() => {
  delete providerOverrides.embedder;
  delete providerOverrides.chat;
});

describe('ingestion', () => {
  it('parses, chunks, embeds and marks documents ready', async () => {
    const id = await ingest({ kind: 'text', name: 'solar.md', text: SOLAR });
    const doc = (await db.documents.get(id))!;
    expect(doc.status).toBe('ready');
    expect(doc.embeddingKey).toBe(embedder.key);
    expect(doc.chunkCount).toBeGreaterThan(0);
    expect(await db.vectors.where('docId').equals(id).count()).toBe(doc.chunkCount);
    const chunks = await db.chunks.where('docId').equals(id).toArray();
    expect(chunks.some((c) => c.headingPath.join('/') === 'Solar power/Maintenance')).toBe(true);
  });

  it('marks documents interrupted mid-pipeline as failed, with the right recovery hint', async () => {
    const resumable = await ingest({ kind: 'text', name: 'solar.md', text: SOLAR });
    await db.documents.update(resumable, { status: 'embedding' });
    await db.documents.add({
      id: 'lost',
      name: 'lost.pdf',
      sourceType: 'file',
      mimeType: '',
      hash: '',
      collectionIds: [],
      charCount: 0,
      chunkCount: 0,
      status: 'parsing',
      progress: 0,
      createdAt: 1,
      updatedAt: 1,
    });

    await recoverInterrupted();

    expect(await db.documents.get(resumable)).toMatchObject({ status: 'error', error: expect.stringMatching(/Retry/) });
    expect(await db.documents.get('lost')).toMatchObject({ status: 'error', error: expect.stringMatching(/add it again/) });
  });

  it('dedupes identical content and merges collections', async () => {
    const first = await ingest({ kind: 'text', name: 'a.md', text: WIND });
    const col = await createCollection('Energy');
    const second = await ingest({ kind: 'text', name: 'b.md', text: WIND }, [col.id]);
    expect(second).toBe(first);
    expect(await db.documents.count()).toBe(1);
    expect((await db.documents.get(first))!.collectionIds).toEqual([col.id]);
  });
});

describe('answer', () => {
  it('retrieves the relevant document and sends numbered sources to the model', async () => {
    await ingest({ kind: 'text', name: 'solar.md', text: SOLAR });
    await ingest({ kind: 'text', name: 'wind.md', text: WIND });
    await ingest({ kind: 'text', name: 'bread.md', text: BAKING });

    const events = await collect(
      answer({ thread: { collectionIds: [] }, history: [], question: 'How efficient are solar panels?', mode: 'chat', webSearch: false, signal: new AbortController().signal }),
    );
    const retrieval = events.find((e) => e.type === 'retrieval');
    expect(retrieval?.type).toBe('retrieval');
    if (retrieval?.type !== 'retrieval') return;
    expect(retrieval.sources[0].docName).toBe('solar.md');
    expect(retrieval.sources[0].n).toBe(1);

    const final = chat.requests.at(-1)!;
    const turn = final.messages.at(-1)!.content;
    expect(turn).toContain('<source id="1" document="solar.md"');
    expect(turn).toContain('<question>');
    expect(final.system).toMatch(/cite them inline/);
    expect(events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? e.text : '')).join('')).toContain('[1]');
  });

  it('only searches the collections a chat is scoped to', async () => {
    const energy = await createCollection('Energy');
    await ingest({ kind: 'text', name: 'solar.md', text: SOLAR });
    await ingest({ kind: 'text', name: 'wind.md', text: WIND }, [energy.id]);

    const events = await collect(
      answer({ thread: { collectionIds: [energy.id] }, history: [], question: 'solar panels efficiency', mode: 'chat', webSearch: false, signal: new AbortController().signal }),
    );
    const retrieval = events.find((e) => e.type === 'retrieval');
    if (retrieval?.type !== 'retrieval') throw new Error('no retrieval event');
    expect(retrieval.sources.every((s) => s.docName === 'wind.md')).toBe(true);
  });

  it('runs deep research as plan → per-query search → gap check → follow-up search → report', async () => {
    await ingest({ kind: 'text', name: 'solar.md', text: SOLAR });
    await ingest({ kind: 'text', name: 'wind.md', text: WIND });

    const events = await collect(
      answer({ thread: { collectionIds: [] }, history: [], question: 'Compare solar and wind', mode: 'research', webSearch: false, signal: new AbortController().signal }),
    );
    const lastSteps = events.filter((e) => e.type === 'steps').at(-1);
    if (lastSteps?.type !== 'steps') throw new Error('no steps');
    expect(lastSteps.steps.map((s) => s.label)).toEqual([
      'Planning the research',
      'Searching: solar panel efficiency',
      'Searching: wind turbine output',
      'Checking the evidence for gaps',
      'Searching: panel cleaning and maintenance',
      'Writing the report',
    ]);
    expect(lastSteps.steps.every((s) => s.status === 'done')).toBe(true);

    const retrieval = events.find((e) => e.type === 'retrieval');
    if (retrieval?.type !== 'retrieval') throw new Error('no retrieval event');
    expect(new Set(retrieval.sources.map((s) => s.docName))).toEqual(new Set(['solar.md', 'wind.md']));
    expect(chat.requests.at(-1)!.effort).toBe('deep');
  });
});

describe('knowledge packs', () => {
  it('round-trips documents, vectors and chats through a gzipped pack', async () => {
    await ingest({ kind: 'text', name: 'solar.md', text: SOLAR });
    await db.threads.add({ id: 't1', title: 'Hi', collectionIds: [], createdAt: 1, updatedAt: 1 });
    const before = await db.vectors.toArray();

    const bytes = await encodePack(await buildPack({ includeChats: true }));
    await Promise.all(db.tables.map((t) => t.clear()));
    const summary = await applyPack(await decodePack(bytes));

    expect(summary).toMatchObject({ documents: 1, threads: 1, needsReindex: 0 });
    const after = await db.vectors.toArray();
    expect(after).toHaveLength(before.length);
    expect(Array.from(after[0].vector)).toEqual(Array.from(before.find((v) => v.chunkId === after[0].chunkId)!.vector));
  });

  it('keeps local collection memberships when importing a scoped pack', async () => {
    const a = await createCollection('A');
    const b = await createCollection('B');
    const id = await ingest({ kind: 'text', name: 'solar.md', text: SOLAR }, [a.id, b.id]);

    const pack = await buildPack({ collectionIds: [a.id] });
    expect(pack.documents[0].collectionIds).toEqual([a.id]);
    await applyPack(pack);

    expect((await db.documents.get(id))!.collectionIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('rejects files that are not packs', async () => {
    await expect(decodePack(new TextEncoder().encode('{"hello":1}').buffer as ArrayBuffer)).rejects.toThrow(/not a CaptBot/);
  });
});
