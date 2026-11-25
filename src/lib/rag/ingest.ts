import { profileKey } from '../auth/profile';
import { db, uid } from '../db';
import { createEmbedder } from '../providers';
import { withRetry } from '../providers/http';
import { getSettings } from '../settings';
import { applyPulled } from '../sync/engine';
import { activeEmbeddingKey, getStorageMode, isServerStorage } from '../sync/mode';
import { remote } from '../sync/remote';
import { resumeUpload, uploadDocument, type UploadInput, type UploadResult } from '../sync/upload';
import type { Chunk, ChunkVector, DocText, KbDocument } from '../types';
import { chunkText } from './chunker';
import { errorText } from './json';
import { ocrPages } from './ocr';
import type { ParsedDoc } from './parsers';
import { contextTitle, embedText, knowledge } from './store';

export type IngestSource = { kind: 'file'; file: File } | { kind: 'url'; url: string } | { kind: 'text'; name: string; text: string };

// Documents are processed one at a time so large uploads don't trip provider rate limits.
const INGEST_LOCK = 'captbot-ingest';

/** Holds a Web Lock while indexing, so other tabs queue behind this one and don't mistake its work for a crash. */
function withIngestLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request(INGEST_LOCK, task) as Promise<T>) : task();
}

// Documents this browser is processing, remembered across a closed tab. With server storage only
// these are marked as interrupted, never another device's upload that is still in progress.
const WORKING_KEY = 'captbot_ingesting';

function working(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(profileKey(WORKING_KEY)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveWorking(ids: Set<string>) {
  try {
    if (ids.size) localStorage.setItem(profileKey(WORKING_KEY), JSON.stringify([...ids]));
    else localStorage.removeItem(profileKey(WORKING_KEY));
  } catch {
    // Storage blocked: an interrupted upload stays in progress until it is retried or removed.
  }
}

function track(id: string, on: boolean) {
  const ids = working();
  if (on) ids.add(id);
  else ids.delete(id);
  saveWorking(ids);
}

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const locked = () => withIngestLock(task);
  const run = queue.then(locked, locked);
  queue = run.catch(() => undefined);
  return run;
}

function sourceName(source: IngestSource): string {
  if (source.kind === 'file') return source.file.name;
  if (source.kind === 'text') return source.name;
  try {
    const u = new URL(source.url);
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return source.url;
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function parseSource(source: IngestSource): Promise<ParsedDoc> {
  // Parsers pull in pdf.js, mammoth, Readability and Turndown; load them on first use.
  const { fetchUrl, normalizeText, parseFile } = await import('./parsers');
  switch (source.kind) {
    case 'file':
      return parseFile(source.file, ocrPages);
    case 'url':
      return fetchUrl(source.url, getSettings().readerProxy, undefined, ocrPages);
    case 'text':
      return { text: normalizeText(source.text), mimeType: 'text/plain' };
  }
}

const patch = (id: string, changes: Partial<KbDocument>) => db.documents.update(id, { ...changes, updatedAt: Date.now() });

/** Splits a document's text into chunks: exact spans over the text, plus any table-header prefix. */
export function toChunks(docId: string, text: string, pageOffsets?: number[]): Chunk[] {
  return chunkText(text, pageOffsets).map((span, i) => {
    const chunk: Chunk = {
      id: uid(),
      docId,
      ordinal: i,
      start: span.start,
      end: span.end,
      text: text.slice(span.start, span.end),
      headingPath: span.headingPath,
      page: span.page,
      pageEnd: span.pageEnd,
    };
    if (span.prefix) chunk.prefix = span.prefix;
    return chunk;
  });
}

/**
 * Adds a source to the knowledge base: parse → dedupe → chunk → embed → index. With server
 * storage the last two happen on the server. The document row appears immediately and its
 * status tracks progress. Resolves to the document id (an existing one if the content was a duplicate).
 */
export function ingest(source: IngestSource, collectionIds: string[] = []): Promise<string> {
  const now = Date.now();
  const doc: KbDocument = {
    id: uid(),
    name: sourceName(source),
    sourceType: source.kind,
    mimeType: '',
    url: source.kind === 'url' ? source.url : undefined,
    hash: '',
    collectionIds,
    charCount: 0,
    chunkCount: 0,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  const added = db.documents.add(doc);
  track(doc.id, true);
  return enqueue(async () => {
    await added;
    try {
      return await processDocument(doc, source);
    } catch (err) {
      await patch(doc.id, { status: 'error', error: errorText(err) });
      throw err;
    } finally {
      track(doc.id, false);
    }
  });
}

async function processDocument(doc: KbDocument, source: IngestSource): Promise<string> {
  await patch(doc.id, { status: 'parsing' });
  const parsed = await parseSource(source);
  const text = parsed.text;
  if (!text.trim()) throw new Error('No text could be extracted from this source.');

  // The user may have removed the document while it was being parsed.
  if (!(await db.documents.get(doc.id))) return doc.id;

  const hash = await sha256(text);
  const duplicate = await db.documents
    .where('hash')
    .equals(hash)
    .filter((d) => d.id !== doc.id && d.status !== 'error')
    .first();
  if (duplicate) {
    const merged = [...new Set([...duplicate.collectionIds, ...doc.collectionIds])];
    await patch(duplicate.id, { collectionIds: merged });
    await db.documents.delete(doc.id);
    return duplicate.id;
  }

  const name = source.kind === 'url' && parsed.title ? parsed.title : doc.name;
  const chunks = toChunks(doc.id, text, parsed.pageOffsets);
  const meta: Partial<KbDocument> = {
    name,
    hash,
    mimeType: parsed.mimeType,
    charCount: text.length,
    chunkCount: chunks.length,
    pageCount: parsed.pageOffsets?.length,
    status: 'embedding',
    progress: 0,
  };

  if (isServerStorage()) {
    const kept = await db.transaction('rw', [db.documents, db.docTexts], async () => {
      if (!(await db.documents.get(doc.id))) return false;
      // The text is cached here too, so the source viewer opens without a round trip.
      await db.docTexts.put({ docId: doc.id, text, pageOffsets: parsed.pageOffsets });
      await patch(doc.id, meta);
      return true;
    });
    const current = kept ? await db.documents.get(doc.id) : undefined;
    return current ? sendToServer(current, { docId: doc.id, text, pageOffsets: parsed.pageOffsets }, chunks, uploadDocument) : doc.id;
  }

  const written = await db.transaction('rw', [db.documents, db.docTexts, db.chunks], async () => {
    // Re-check inside the transaction: the user may have removed it while it was being chunked.
    if (!(await db.documents.get(doc.id))) return false;
    await db.docTexts.put({ docId: doc.id, text, pageOffsets: parsed.pageOffsets });
    await db.chunks.bulkPut(chunks);
    await patch(doc.id, meta);
    return true;
  });
  if (!written) return doc.id;

  const current = await db.documents.get(doc.id);
  if (current) await embedDocument(current, chunks);
  return doc.id;
}

/** Sends a document to the account index and mirrors the outcome in the local row. Resolves to the id the document ends up with. */
async function sendToServer(doc: KbDocument, source: DocText, chunks: Chunk[], send: (u: UploadInput) => Promise<UploadResult>): Promise<string> {
  const result = await send({
    doc: { ...doc, chunkCount: chunks.length },
    text: source.text,
    pageOffsets: source.pageOffsets,
    chunks,
    onProgress: (progress) => db.documents.update(doc.id, { progress }),
    cancelled: async () => !(await db.documents.get(doc.id)),
  });
  if (result.status === 'duplicate' && result.existing.id !== doc.id) {
    // The account already has this text: use that document (the server added the collections to it).
    await applyPulled([{ table: 'documents', id: result.existing.id, row: result.existing as unknown as Record<string, unknown> }]);
    await db.documents.delete(doc.id);
    return result.existing.id;
  }
  // A duplicate of itself: this very document was already fully indexed (a retry after it finished).
  if (result.status === 'done' || result.status === 'duplicate') {
    await patch(doc.id, { status: 'ready', progress: 1, embeddingKey: getStorageMode().embeddingKey ?? undefined, error: undefined });
  }
  return doc.id;
}

/** Embeds a document's chunks with the active embedding model and marks it ready. */
export async function embedDocument(doc: KbDocument, chunks: Chunk[]): Promise<void> {
  const embedder = createEmbedder(getSettings());
  const vectors: ChunkVector[] = [];
  for (let i = 0; i < chunks.length; i += embedder.batchSize) {
    const batch = chunks.slice(i, i + embedder.batchSize);
    const embedded = await withRetry(() => embedder.embedDocuments(batch.map((c) => ({ title: contextTitle(doc.name, c.headingPath), text: embedText(c) }))));
    batch.forEach((c, j) => vectors.push({ chunkId: c.id, docId: doc.id, embeddingKey: embedder.key, vector: embedded[j] }));
    // Stop quietly if the user deleted the document mid-way.
    if (!(await db.documents.get(doc.id))) return;
    await db.documents.update(doc.id, { progress: Math.min(1, (i + batch.length) / chunks.length) });
  }

  const stored = await db.transaction('rw', [db.vectors, db.documents], async () => {
    if (!(await db.documents.get(doc.id))) return false; // removed during the last batch
    await db.vectors.where('docId').equals(doc.id).delete();
    await db.vectors.bulkPut(vectors);
    await patch(doc.id, { status: 'ready', progress: 1, embeddingKey: embedder.key, error: undefined });
    return true;
  });
  if (stored) knowledge.addDocument(doc, chunks, vectors);
}

async function reembed(doc: KbDocument) {
  await patch(doc.id, { status: 'embedding', progress: 0, error: undefined });
  try {
    const chunks = await db.chunks.where('docId').equals(doc.id).sortBy('ordinal');
    if (!chunks.length) throw new Error('This document has no stored text to index. Remove it and add it again.');
    await embedDocument(doc, chunks);
  } catch (err) {
    await patch(doc.id, { status: 'error', error: errorText(err) });
  }
}

/**
 * Finishes a server upload that failed or was interrupted, from this browser's copy of the text or
 * the server's. Resolves to true when neither has the text and the URL must be fetched again.
 */
async function resumeOnServer(doc: KbDocument): Promise<boolean> {
  track(doc.id, true);
  await patch(doc.id, { status: 'embedding', error: undefined });
  try {
    let source = await db.docTexts.get(doc.id);
    if (!source) {
      const state = await remote().documentState(doc.id);
      const complete = state.exists && state.textLength > 0 && state.textLength === state.expectedLength;
      const fetched = complete ? await remote().documentText(doc.id) : null;
      if (fetched) source = { docId: doc.id, text: fetched.text, pageOffsets: fetched.pageOffsets };
    }
    if (!source) {
      if (!doc.url) throw new Error("This document's text never reached the server. Remove it and add it again.");
      return true;
    }
    const hash = doc.hash || (await sha256(source.text));
    await sendToServer({ ...doc, hash }, source, toChunks(doc.id, source.text, source.pageOffsets), resumeUpload);
  } catch (err) {
    await patch(doc.id, { status: 'error', error: errorText(err) });
  } finally {
    track(doc.id, false);
  }
  return false;
}

/**
 * Uploads a document that so far exists only in this browser (indexed before server storage,
 * or restored from a pack). The server re-embeds it; this browser's chunks and vectors go.
 */
export function uploadLocalDocument(id: string): Promise<void> {
  track(id, true);
  return enqueue(async () => {
    try {
      const doc = await db.documents.get(id);
      const source = await db.docTexts.get(id);
      if (!doc || !source) return;
      await patch(id, { status: 'embedding', progress: 0, error: undefined });
      const hash = doc.hash || (await sha256(source.text));
      const finalId = await sendToServer({ ...doc, hash }, source, toChunks(id, source.text, source.pageOffsets), uploadDocument);
      if (finalId === id) {
        await db.chunks.where('docId').equals(id).delete();
        await db.vectors.where('docId').equals(id).delete();
        knowledge.invalidate();
      }
    } catch (err) {
      await patch(id, { status: 'error', error: errorText(err) });
    } finally {
      track(id, false);
    }
  });
}

/** Documents indexed with a different embedding model than the current one. Server storage has one model, so none. */
export async function staleDocuments(): Promise<KbDocument[]> {
  if (isServerStorage()) return [];
  const key = activeEmbeddingKey(getSettings());
  return (await db.documents.toArray()).filter((d) => d.status === 'ready' && d.embeddingKey !== key);
}

export async function reindexStale(): Promise<number> {
  const stale = await staleDocuments();
  for (const doc of stale) void enqueue(() => reembed(doc));
  return stale.length;
}

/** Retries a failed document: finishes a server upload, re-embeds stored chunks, or re-fetches URL sources. */
export async function retryDocument(id: string): Promise<void> {
  const doc = await db.documents.get(id);
  if (!doc) return;
  if (isServerStorage()) {
    const refetch = await enqueue(() => resumeOnServer(doc));
    // A fresh ingest queues on its own, so it starts after the resume task, never inside it.
    if (refetch && doc.url) {
      await db.documents.delete(id);
      await ingest({ kind: 'url', url: doc.url }, doc.collectionIds).catch(() => undefined);
    }
    return;
  }
  const hasChunks = (await db.chunks.where('docId').equals(id).count()) > 0;
  if (hasChunks) {
    await enqueue(() => reembed(doc));
  } else if (doc.url) {
    await db.documents.delete(id);
    await ingest({ kind: 'url', url: doc.url }, doc.collectionIds).catch(() => undefined);
  }
}

/** Marks documents left mid-pipeline by a closed tab as failed, so they can be retried instead of spinning forever. */
export async function recoverInterrupted(): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // While another tab holds the ingest lock, its in-progress documents aren't stuck.
  if (locks) await locks.request(INGEST_LOCK, { ifAvailable: true }, async (lock) => lock && markStuck());
  else await markStuck();
}

async function markStuck(): Promise<void> {
  const mine = working();
  const server = isServerStorage();
  const stuck = await db.documents.where('status').anyOf(['queued', 'parsing', 'embedding']).toArray();
  // Nothing is processing now (no tab holds the lock), so nothing tracked is still running.
  saveWorking(new Set());
  for (const doc of stuck) {
    // With server storage a document mid-upload may be another device's work in progress: leave it.
    if (server && !mine.has(doc.id)) continue;
    const resumable = Boolean(doc.url) || (await db.chunks.where('docId').equals(doc.id).count()) > 0 || Boolean(await db.docTexts.get(doc.id));
    await patch(doc.id, {
      status: 'error',
      error: resumable ? 'Indexing was interrupted. Retry to finish it.' : 'Indexing was interrupted. Remove this document and add it again.',
    });
  }
}
