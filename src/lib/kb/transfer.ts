import { db } from '../db';
import { toChunks, uploadLocalDocument } from '../rag/ingest';
import { knowledge } from '../rag/store';
import { getStorageMode, isServerStorage } from '../sync/mode';
import { remote } from '../sync/remote';
import type { ChatMessage, Chunk, Collection, DocText, KbDocument, SavedPrompt, Thread } from '../types';

export const PACK_FORMAT = 'captbot-pack';
export const PACK_EXTENSION = '.captbot';

interface PackedVector {
  chunkId: string;
  docId: string;
  embeddingKey: string;
  /** base64 of little-endian float32 bytes */
  vector: string;
}

export interface KnowledgePack {
  format: typeof PACK_FORMAT;
  version: 1;
  exportedAt: string;
  collections: Collection[];
  documents: KbDocument[];
  texts: DocText[];
  chunks: Chunk[];
  vectors: PackedVector[];
  threads: Thread[];
  messages: ChatMessage[];
  prompts: SavedPrompt[];
}

export interface PackOptions {
  /** Export only these collections (a shareable knowledge pack). Omit for a full backup. */
  collectionIds?: string[];
  /** Include chats and saved prompts (full backups only). */
  includeChats?: boolean;
  /** Include embeddings so the importer doesn't need to re-index. Default true. */
  includeVectors?: boolean;
}

export interface ImportSummary {
  collections: number;
  documents: number;
  threads: number;
  needsReindex: number;
}

function f32ToBase64(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToF32(b64: string): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export async function buildPack(opts: PackOptions = {}): Promise<KnowledgePack> {
  const scope = opts.collectionIds?.length ? new Set(opts.collectionIds) : null;
  const collections = scope ? (await db.collections.bulkGet([...scope])).filter((c): c is Collection => Boolean(c)) : await db.collections.toArray();
  let documents = scope
    ? await db.documents
        .where('collectionIds')
        .anyOf([...scope])
        .distinct()
        .toArray()
    : await db.documents.toArray();
  if (scope) documents = documents.map((d) => ({ ...d, collectionIds: d.collectionIds.filter((c) => scope.has(c)) }));

  const docIds = documents.map((d) => d.id);
  const texts = (await db.docTexts.bulkGet(docIds)).filter((t): t is DocText => Boolean(t));
  const chunks = await db.chunks.where('docId').anyOf(docIds).toArray();

  if (isServerStorage()) {
    // Documents added on other devices have their text only on the server.
    const cached = new Set(texts.map((t) => t.docId));
    for (const d of documents) {
      if (cached.has(d.id) || d.status !== 'ready') continue;
      const fetched = await remote().documentText(d.id);
      if (fetched) texts.push({ docId: d.id, text: fetched.text, pageOffsets: fetched.pageOffsets });
    }
    // Server-stored documents keep no chunks here; the chunker is deterministic, so rebuild them from the text.
    const chunked = new Set(chunks.map((c) => c.docId));
    for (const t of texts) if (!chunked.has(t.docId)) chunks.push(...toChunks(t.docId, t.text, t.pageOffsets));
  }

  const vectors =
    opts.includeVectors === false
      ? []
      : (await db.vectors.where('docId').anyOf(docIds).toArray()).map((v) => ({
          chunkId: v.chunkId,
          docId: v.docId,
          embeddingKey: v.embeddingKey,
          vector: f32ToBase64(v.vector),
        }));
  // A document packed without vectors has to be re-indexed wherever it's imported.
  const vectorDocs = new Set(vectors.map((v) => v.docId));
  documents = documents.map((d) => (vectorDocs.has(d.id) ? d : { ...d, embeddingKey: undefined }));
  const withChats = Boolean(opts.includeChats) && !scope;

  return {
    format: PACK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    collections,
    documents,
    texts,
    chunks,
    vectors,
    threads: withChats ? await db.threads.toArray() : [],
    messages: withChats ? await db.messages.toArray() : [],
    prompts: withChats ? await db.prompts.toArray() : [],
  };
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Gzipped JSON. */
export async function encodePack(pack: KnowledgePack): Promise<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(pack));
  return new Response(streamOf(json).pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

export async function decodePack(buffer: ArrayBuffer): Promise<KnowledgePack> {
  const bytes = new Uint8Array(buffer);
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped ? await new Response(streamOf(bytes).pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
  let pack: KnowledgePack;
  try {
    pack = JSON.parse(text);
  } catch {
    throw new Error('This file is not a CaptBot backup or knowledge pack.');
  }
  if (pack?.format !== PACK_FORMAT) throw new Error('This file is not a CaptBot backup or knowledge pack.');
  if (pack.version !== 1) throw new Error(`Unsupported pack version ${String(pack.version)}. Update CaptBot and try again.`);
  return pack;
}

/**
 * With server storage, collections, chats and prompts sync like any edit, and each document is
 * uploaded so the server indexes it. Documents the account already has indexed are left alone.
 */
async function applyPackToAccount(pack: KnowledgePack): Promise<ImportSummary> {
  const serverKey = getStorageMode().embeddingKey;
  const local = new Map((await db.documents.bulkGet(pack.documents.map((d) => d.id))).flatMap((d) => (d ? [[d.id, d] as const] : [])));
  const withText = new Set(pack.texts.map((t) => t.docId));
  const incoming = pack.documents.filter((d) => {
    const mine = local.get(d.id);
    return withText.has(d.id) && !(mine?.status === 'ready' && mine.embeddingKey === serverKey);
  });
  const ids = new Set(incoming.map((d) => d.id));

  await db.transaction('rw', [db.collections, db.documents, db.docTexts, db.threads, db.messages, db.prompts], async () => {
    await db.collections.bulkPut(pack.collections);
    await db.documents.bulkPut(
      incoming.map((d) => ({
        ...d,
        collectionIds: [...new Set([...(local.get(d.id)?.collectionIds ?? []), ...d.collectionIds])],
        status: 'queued' as const,
        progress: 0,
        error: undefined,
        embeddingKey: undefined,
      })),
    );
    await db.docTexts.bulkPut(pack.texts.filter((t) => ids.has(t.docId)));
    await db.threads.bulkPut(pack.threads);
    await db.messages.bulkPut(pack.messages);
    await db.prompts.bulkPut(pack.prompts);
  });
  for (const d of incoming) void uploadLocalDocument(d.id);
  return { collections: pack.collections.length, documents: incoming.length, threads: pack.threads.length, needsReindex: 0 };
}

/** Merges a pack into the knowledge base. Records with the same id are overwritten. */
export async function applyPack(pack: KnowledgePack): Promise<ImportSummary> {
  if (isServerStorage()) return applyPackToAccount(pack);

  const vectorKeys = new Map<string, string>();
  for (const v of pack.vectors) vectorKeys.set(v.docId, v.embeddingKey);

  const local = new Map((await db.documents.bulkGet(pack.documents.map((d) => d.id))).flatMap((d) => (d ? [[d.id, d] as const] : [])));
  const documents: KbDocument[] = pack.documents.map((d) => {
    const mine = local.get(d.id);
    const unfinished = d.status !== 'ready' && d.status !== 'error';
    return {
      ...d,
      // A scoped pack only knows its own collections; keep this device's other memberships.
      collectionIds: [...new Set([...(mine?.collectionIds ?? []), ...d.collectionIds])],
      status: unfinished ? 'error' : d.status,
      error: unfinished ? 'This document was still processing when it was exported. Retry to index it.' : d.error,
      progress: unfinished ? 0 : d.progress,
      // A pack without vectors leaves the local vectors (and their model) in place.
      embeddingKey: vectorKeys.get(d.id) ?? mine?.embeddingKey,
    };
  });

  await db.transaction('rw', [db.collections, db.documents, db.docTexts, db.chunks, db.vectors, db.threads, db.messages, db.prompts], async () => {
    await db.collections.bulkPut(pack.collections);
    await db.documents.bulkPut(documents);
    await db.docTexts.bulkPut(pack.texts);
    await db.chunks.bulkPut(pack.chunks);
    await db.vectors.bulkPut(pack.vectors.map((v) => ({ chunkId: v.chunkId, docId: v.docId, embeddingKey: v.embeddingKey, vector: base64ToF32(v.vector) })));
    await db.threads.bulkPut(pack.threads);
    await db.messages.bulkPut(pack.messages);
    await db.prompts.bulkPut(pack.prompts);
  });
  knowledge.invalidate();
  return {
    collections: pack.collections.length,
    documents: documents.length,
    threads: pack.threads.length,
    needsReindex: documents.filter((d) => d.status === 'ready' && !d.embeddingKey).length,
  };
}
