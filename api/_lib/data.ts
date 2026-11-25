import type {
  AddChunksBody,
  AppendTextBody,
  ChunkUpload,
  CreateDocumentBody,
  LimitScope,
  SearchBody,
  SearchHit,
  StatusResponse,
  SyncChange,
  SyncCursors,
  SyncTable,
} from './contract.js';
import type { DataStore } from './datastore.js';
import { contextTitle, documentInput, embedText, queryInput, toTsQuery } from './embedFormat.js';
import { errorResponse, HttpError, isObject, json, limitHeaders, rateLimited, readJson, requireUser, type ApiDeps } from './handlers.js';

/** Server storage always indexes with one model, so every device searches the same vector space. */
export const STORAGE_EMBED_MODEL = 'gemini-embedding-2';
export const STORAGE_DIMENSIONS = 768;
export const STORAGE_EMBEDDING_KEY = `server:${STORAGE_EMBED_MODEL}:${STORAGE_DIMENSIONS}`;

const MAX_BODY = 4_000_000; // under Vercel's 4.5 MB request limit
const MAX_CHANGES = 200;
const MAX_TEXT_PART = 1_000_000;
const MAX_DOCUMENT_CHARS = 20_000_000;
const MAX_CHUNKS = 64;
const MAX_CHUNK_CHARS = 12_000;
const MAX_ID = 128;
const MAX_QUERY = 2_000;
const MAX_SEARCH = 50;
const SYNC_TABLES: readonly SyncTable[] = ['collections', 'documents', 'threads', 'messages', 'prompts'];

function object(raw: unknown, what = 'body'): Record<string, unknown> {
  if (!isObject(raw)) throw new HttpError(400, `Expected a JSON object for ${what}.`);
  return raw;
}
function str(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v || v.length > max) throw new HttpError(400, `${field} must be a non-empty string of at most ${max} characters.`);
  return v;
}
function optStr(v: unknown, field: string, max: number): string | undefined {
  return v === undefined || v === null ? undefined : str(v, field, max);
}
function int(v: unknown, field: string, min = 0, max = 2 ** 31 - 1): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${field} must be an integer from ${min} to ${max}.`);
  return v;
}
function optInt(v: unknown, field: string): number | undefined {
  return v === undefined || v === null ? undefined : int(v, field);
}
function idList(v: unknown, field: string, maxItems = 1000): string[] {
  if (!Array.isArray(v) || v.length > maxItems || !v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_ID)) {
    throw new HttpError(400, `${field} must be a list of at most ${maxItems} ids.`);
  }
  return v as string[];
}
function textList(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length > 20 || !v.every((s) => typeof s === 'string' && s.length <= 500)) {
    throw new HttpError(400, `${field} must be a short list of strings.`);
  }
  return v as string[];
}
/** Document text and chunks must be exact, so NUL characters (which Postgres can't store) are rejected, not dropped. */
function noNul(s: string, field: string): string {
  if (s.includes('\x00')) throw new HttpError(400, `${field} must not contain NUL characters.`);
  return s;
}

export function parseCursors(raw: unknown): SyncCursors {
  const body = object(raw);
  const given = body.cursors === undefined ? {} : object(body.cursors, 'cursors');
  const cursors: SyncCursors = {};
  for (const table of SYNC_TABLES) if (given[table] !== undefined) cursors[table] = str(given[table], 'cursor', 300);
  return cursors;
}

export function parsePush(raw: unknown): SyncChange[] {
  const { changes } = object(raw);
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new HttpError(400, `changes must be a list of at most ${MAX_CHANGES}.`);
  return changes.map((c) => {
    const change = object(c, 'a change');
    if (!SYNC_TABLES.includes(change.table as SyncTable)) throw new HttpError(400, 'Unknown table.');
    return {
      table: change.table as SyncTable,
      id: str(change.id, 'id', MAX_ID),
      row: change.row === undefined || change.row === null ? undefined : object(change.row, 'row'),
    };
  });
}

export function parseCreateDocument(raw: unknown): CreateDocumentBody {
  const b = object(raw);
  if (b.sourceType !== 'file' && b.sourceType !== 'url' && b.sourceType !== 'text') throw new HttpError(400, 'sourceType must be file, url or text.');
  if (
    b.pageOffsets !== undefined &&
    (!Array.isArray(b.pageOffsets) || b.pageOffsets.length > 100_000 || !b.pageOffsets.every((n) => Number.isInteger(n) && n >= 0))
  ) {
    throw new HttpError(400, 'pageOffsets must be a list of offsets.');
  }
  return {
    id: str(b.id, 'id', MAX_ID),
    name: str(b.name, 'name', 500),
    sourceType: b.sourceType,
    mimeType: typeof b.mimeType === 'string' ? b.mimeType.slice(0, 200) : '',
    url: optStr(b.url, 'url', 4000),
    hash: str(b.hash, 'hash', 128),
    collectionIds: idList(b.collectionIds, 'collectionIds'),
    charCount: int(b.charCount, 'charCount', 0, MAX_DOCUMENT_CHARS * 2),
    textLength: int(b.textLength, 'textLength', 0, MAX_DOCUMENT_CHARS),
    chunkCount: int(b.chunkCount, 'chunkCount', 1, 500_000),
    pageCount: optInt(b.pageCount, 'pageCount'),
    pageOffsets: b.pageOffsets as number[] | undefined,
    createdAt: int(b.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseAppendText(raw: unknown): AppendTextBody {
  const b = object(raw);
  if (typeof b.text !== 'string' || b.text.length > MAX_TEXT_PART) throw new HttpError(400, `text must be a string of at most ${MAX_TEXT_PART} characters.`);
  return { docId: str(b.docId, 'docId', MAX_ID), index: int(b.index, 'index', 0, 10_000), text: noNul(b.text, 'text') };
}

function parseChunk(raw: unknown): ChunkUpload {
  const c = object(raw, 'a chunk');
  if (typeof c.text !== 'string' || !c.text || c.text.length > MAX_CHUNK_CHARS)
    throw new HttpError(400, `Chunk text must be at most ${MAX_CHUNK_CHARS} characters.`);
  if (c.prefix !== undefined && (typeof c.prefix !== 'string' || c.prefix.length > 4000)) throw new HttpError(400, 'Chunk prefix is too long.');
  return {
    id: str(c.id, 'chunk id', MAX_ID),
    ordinal: int(c.ordinal, 'ordinal', 0, 500_000),
    start: int(c.start, 'start'),
    end: int(c.end, 'end'),
    text: noNul(c.text, 'Chunk text'),
    prefix: c.prefix === undefined ? undefined : noNul(c.prefix as string, 'Chunk prefix'),
    headingPath: textList(c.headingPath, 'headingPath').map((h) => noNul(h, 'headingPath')),
    page: optInt(c.page, 'page'),
    pageEnd: optInt(c.pageEnd, 'pageEnd'),
  };
}

export function parseAddChunks(raw: unknown): AddChunksBody {
  const b = object(raw);
  if (!Array.isArray(b.chunks) || !b.chunks.length || b.chunks.length > MAX_CHUNKS) {
    throw new HttpError(400, `chunks must be a non-empty list of at most ${MAX_CHUNKS}.`);
  }
  return { docId: str(b.docId, 'docId', MAX_ID), chunks: b.chunks.map(parseChunk) };
}

export function parseDocId(raw: unknown): string {
  return str(object(raw).docId, 'docId', MAX_ID);
}

export function parseSearch(raw: unknown): SearchBody {
  const b = object(raw);
  return {
    query: str(b.query, 'query', MAX_QUERY),
    collectionIds: idList(b.collectionIds ?? [], 'collectionIds', 500),
    limit: int(b.limit ?? 30, 'limit', 1, MAX_SEARCH),
  };
}

/** Counts the request against an allowance, runs it, and attaches the allowance headers. */
async function limited(deps: ApiDeps, userId: string, scope: LimitScope, run: () => Promise<Response>): Promise<Response> {
  const decision = await deps.limiter.consume(userId, scope);
  if (!decision.ok) return rateLimited(scope, decision);
  const res = await run();
  for (const [key, value] of Object.entries(limitHeaders(decision))) res.headers.set(key, value);
  return res;
}

async function addChunks(deps: ApiDeps, store: DataStore, userId: string, body: AddChunksBody, signal: AbortSignal): Promise<Response> {
  const name = await store.documentName(userId, body.docId);
  if (name === null) throw new HttpError(404, 'Document not found.');
  return limited(deps, userId, 'embed', async () => {
    const titles = body.chunks.map((c) => contextTitle(name, c.headingPath));
    const vectors = await deps.embed.embed(
      { model: STORAGE_EMBED_MODEL, dimensions: STORAGE_DIMENSIONS, texts: body.chunks.map((c, i) => documentInput(titles[i], embedText(c))) },
      signal,
    );
    if (vectors.length !== body.chunks.length || vectors.some((v) => v.length !== STORAGE_DIMENSIONS)) {
      throw new HttpError(502, 'The embedding provider returned an incomplete response.');
    }
    const stored = body.chunks.map((c, i) => ({ ...c, title: titles[i], embedding: vectors[i] }));
    return json(200, await store.addChunks(userId, body.docId, stored, STORAGE_EMBEDDING_KEY));
  });
}

async function search(deps: ApiDeps, store: DataStore, userId: string, body: SearchBody, signal: AbortSignal): Promise<Response> {
  return limited(deps, userId, 'search', async () => {
    const docs = await store.scope(userId, body.collectionIds);
    if (!docs.length) return json(200, { hits: [], semantic: true });

    let vector: number[] | null = null;
    try {
      [vector] = await deps.embed.embed({ model: STORAGE_EMBED_MODEL, dimensions: STORAGE_DIMENSIONS, texts: [queryInput(body.query)] }, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      // Keyword search still works without the embedding; the client reports it.
      console.error(err);
    }
    const ranked = await store.search(userId, { docIds: docs.map((d) => d.id), vector, tsquery: toTsQuery(body.query), limit: body.limit });
    const neighbors = await store.neighbors(
      userId,
      ranked.flatMap((r) => [
        { docId: r.chunk.docId, ordinal: r.chunk.ordinal - 1 },
        { docId: r.chunk.docId, ordinal: r.chunk.ordinal + 1 },
      ]),
    );
    const at = new Map(neighbors.map((c) => [`${c.docId}:${c.ordinal}`, c]));
    const names = new Map(docs.map((d) => [d.id, d.name]));
    const hits: SearchHit[] = ranked.map((r) => ({
      chunk: r.chunk,
      docName: names.get(r.chunk.docId) ?? '',
      score: r.score,
      neighbors: [at.get(`${r.chunk.docId}:${r.chunk.ordinal - 1}`), at.get(`${r.chunk.docId}:${r.chunk.ordinal + 1}`)].filter(
        (c): c is NonNullable<typeof c> => Boolean(c),
      ),
    }));
    return json(200, { hits, semantic: vector !== null });
  });
}

/**
 * POST /api/data?op=…: the signed-in user's knowledge base on the server. Every op is
 * scoped to the user from the session token, never to anything in the request body.
 * Bodies are validated before any allowance is spent.
 */
export function createDataHandler(deps: ApiDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' }, { allow: 'POST' });
    try {
      const userId = await requireUser(req, deps);
      const store = deps.store;
      if (!store) throw new HttpError(503, 'Server storage is not configured.');
      const op = new URL(req.url).searchParams.get('op');
      const body = await readJson(req, MAX_BODY);
      const signal = req.signal ?? new AbortController().signal;

      // Every branch awaits, so its errors land in the catch below rather than escaping as a rejection.
      switch (op) {
        case 'status': {
          const status: StatusResponse = {
            storage: true,
            embedModel: STORAGE_EMBED_MODEL,
            dimensions: STORAGE_DIMENSIONS,
            embeddingKey: STORAGE_EMBEDDING_KEY,
          };
          return json(200, status);
        }
        case 'pull':
          return json(200, await store.pull(userId, parseCursors(body)));
        case 'push': {
          const changes = parsePush(body);
          return await limited(deps, userId, 'write', async () => json(200, await store.push(userId, changes)));
        }
        case 'create-document': {
          const doc = parseCreateDocument(body);
          return await limited(deps, userId, 'write', async () => json(200, await store.createDocument(userId, doc)));
        }
        case 'append-text': {
          const part = parseAppendText(body);
          return await limited(deps, userId, 'write', async () => {
            await store.appendText(userId, part);
            return json(200, { ok: true });
          });
        }
        case 'add-chunks':
          return await addChunks(deps, store, userId, parseAddChunks(body), signal);
        case 'complete-document':
          await store.completeDocument(userId, parseDocId(body), STORAGE_EMBEDDING_KEY);
          return json(200, { ok: true });
        case 'document-state':
          return json(200, await store.documentState(userId, parseDocId(body)));
        case 'document-text': {
          const text = await store.documentText(userId, parseDocId(body));
          if (!text) throw new HttpError(404, 'Document not found.');
          return json(200, text);
        }
        case 'search':
          return await search(deps, store, userId, parseSearch(body), signal);
        case 'wipe':
          await store.wipe(userId);
          return json(200, { ok: true });
        default:
          throw new HttpError(400, 'Unknown op.');
      }
    } catch (err) {
      return errorResponse(err);
    }
  };
}
