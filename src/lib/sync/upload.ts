import type { ChunkUpload } from '../../../api/_lib/contract';
import { withRetry } from '../providers/http';
import type { Chunk, KbDocument } from '../types';
import { remote } from './remote';

const TEXT_PART = 900_000; // characters per request, well under the API's body limit
const CHUNK_BATCH = 48;

/** Length in code points, as Postgres counts it (JS counts an emoji as two). */
export function codePoints(text: string): number {
  let pairs = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        pairs++;
        i++;
      }
    }
  }
  return text.length - pairs;
}

/** Splits text into upload parts, never between the two halves of a surrogate pair. */
export function textParts(text: string, size = TEXT_PART): string[] {
  const parts: string[] = [];
  for (let from = 0; from < text.length; ) {
    let to = Math.min(text.length, from + size);
    const last = text.charCodeAt(to - 1);
    if (to < text.length && last >= 0xd800 && last <= 0xdbff) to--;
    parts.push(text.slice(from, to));
    from = to;
  }
  return parts.length ? parts : [''];
}

const toUpload = (c: Chunk): ChunkUpload => ({
  id: c.id,
  ordinal: c.ordinal,
  start: c.start,
  end: c.end,
  text: c.text,
  prefix: c.prefix,
  headingPath: c.headingPath,
  page: c.page,
  pageEnd: c.pageEnd,
});

export interface UploadInput {
  doc: KbDocument;
  text: string;
  pageOffsets?: number[];
  chunks: Chunk[];
  /** Called with 0..1 as chunk batches are indexed. */
  onProgress?: (progress: number) => unknown;
  /** Checked between batches; stops the upload quietly when the user removed the document. */
  cancelled?: () => Promise<boolean>;
}

async function sendRest(u: UploadInput, partsDone: number, ordinalsDone: Set<number>): Promise<boolean> {
  const r = remote();
  const parts = textParts(u.text);
  for (let i = partsDone; i < parts.length; i++) {
    await withRetry(() => r.appendText({ docId: u.doc.id, index: i, text: parts[i] }));
  }
  const todo = u.chunks.filter((c) => !ordinalsDone.has(c.ordinal));
  let done = u.chunks.length - todo.length;
  for (let i = 0; i < todo.length; i += CHUNK_BATCH) {
    if (await u.cancelled?.()) return false;
    const batch = todo.slice(i, i + CHUNK_BATCH);
    await withRetry(() => r.addChunks({ docId: u.doc.id, chunks: batch.map(toUpload) }));
    done += batch.length;
    await u.onProgress?.(done / u.chunks.length);
  }
  await withRetry(() => r.completeDocument(u.doc.id));
  return true;
}

export type UploadResult = { status: 'done' } | { status: 'cancelled' } | { status: 'duplicate'; existing: KbDocument };

/**
 * Sends a parsed, chunked document to the account: its text in parts, then chunks in batches
 * that the server embeds and indexes. Every step is safe to retry.
 */
export async function uploadDocument(u: UploadInput): Promise<UploadResult> {
  const { doc, text, chunks } = u;
  const created = await withRetry(() =>
    remote().createDocument({
      id: doc.id,
      name: doc.name,
      sourceType: doc.sourceType,
      mimeType: doc.mimeType,
      url: doc.url,
      hash: doc.hash,
      collectionIds: doc.collectionIds,
      charCount: text.length,
      textLength: codePoints(text),
      chunkCount: chunks.length,
      pageCount: u.pageOffsets?.length,
      pageOffsets: u.pageOffsets,
      createdAt: doc.createdAt,
    }),
  );
  if (created.duplicateOf) return { status: 'duplicate', existing: created.duplicateOf as unknown as KbDocument };
  return (await sendRest(u, 0, new Set())) ? { status: 'done' } : { status: 'cancelled' };
}

/** Finishes an interrupted upload, sending only the text parts and chunks the server doesn't have. */
export async function resumeUpload(u: UploadInput): Promise<UploadResult> {
  const state = await remote().documentState(u.doc.id);
  if (!state.exists) return uploadDocument(u);
  return (await sendRest(u, state.parts, new Set(state.ordinals))) ? { status: 'done' } : { status: 'cancelled' };
}
