/**
 * Request and response shapes shared by the API routes and the browser client.
 * Types only, so importing this never pulls server code into the client bundle.
 */

/** Which server model to use: answers and reports, or quick utility calls. */
export type Tier = 'main' | 'fast';
export type Effort = 'low' | 'normal' | 'deep';

export interface ChatImage {
  name: string;
  mimeType: string;
  /** base64, no data: prefix */
  data: string;
}

export interface ChatTurnBody {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
}

export interface ChatBody {
  tier: Tier;
  system?: string;
  messages: ChatTurnBody[];
  json?: boolean;
  webSearch?: boolean;
  effort?: Effort;
  maxTokens?: number;
}

/** One `data:` event of the /api/chat SSE stream. */
export interface ChatDeltaBody {
  text?: string;
  webSources?: { title: string; uri: string }[];
}

export interface EmbedBody {
  model: string;
  dimensions: number;
  /** Already formatted for the model (task prefixes applied by the client). */
  texts: string[];
  taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
}

export interface EmbedResponse {
  vectors: number[][];
}

/** chat and embed: model calls. search: knowledge-base searches. write: saves to server storage. */
export type LimitScope = 'chat' | 'embed' | 'search' | 'write';

export interface LimitState {
  limit: number;
  remaining: number;
  /** Unix ms when the window resets. */
  reset: number;
}

export interface RateLimitedBody extends LimitState {
  error: 'rate_limited';
  scope: LimitScope;
  window: 'minute' | 'day';
}

export interface UsageBody {
  chat: LimitState;
  embed: LimitState;
}

// ── Server storage: POST /api/data?op=… ─────────────────────────────────────

export type SyncTable = 'collections' | 'documents' | 'threads' | 'messages' | 'prompts';

/** One record change. No row means the record was deleted. Rows use the browser's field names. */
export interface SyncChange {
  table: SyncTable;
  id: string;
  row?: Record<string, unknown>;
}

export interface PushBody {
  changes: SyncChange[];
}

export interface PushResponse {
  applied: number;
  /** Changes the server couldn't store (each is reported, the rest of the batch still applies). */
  rejected: { table: SyncTable; id: string; error: string }[];
}

/** Per table, where the device got up to: "synced_at|id" of the last row it received. */
export type SyncCursors = Partial<Record<SyncTable, string>>;

export interface PullBody {
  cursors: SyncCursors;
}

export interface PullResponse {
  changes: SyncChange[];
  cursors: SyncCursors;
  /** A table had more rows than fit in one response; pull again with the new cursors. */
  more: boolean;
}

export interface StatusResponse {
  storage: true;
  embedModel: string;
  dimensions: number;
  /** Identifies the server's vector space, stored on every document it indexes. */
  embeddingKey: string;
}

export interface CreateDocumentBody {
  id: string;
  name: string;
  sourceType: 'file' | 'url' | 'text';
  mimeType: string;
  url?: string;
  hash: string;
  collectionIds: string[];
  /** UTF-16 length, as the browser counts it (shown in the UI). */
  charCount: number;
  /** Length in code points, as Postgres counts it; the upload is complete when the stored text reaches it. */
  textLength: number;
  chunkCount: number;
  pageCount?: number;
  pageOffsets?: number[];
  createdAt: number;
}

export interface CreateDocumentResponse {
  /** An existing document with the same text. The upload stops; this one is used instead. */
  duplicateOf?: Record<string, unknown>;
}

export interface AppendTextBody {
  docId: string;
  /** Parts arrive in order from 0; a repeated part is ignored, so retries are safe. */
  index: number;
  text: string;
}

export interface ChunkUpload {
  id: string;
  ordinal: number;
  start: number;
  end: number;
  text: string;
  prefix?: string;
  headingPath: string[];
  page?: number;
  pageEnd?: number;
}

export interface AddChunksBody {
  docId: string;
  chunks: ChunkUpload[];
}

export interface AddChunksResponse {
  stored: number;
  /** Share of the document's chunks now indexed, 0..1. */
  progress: number;
}

export interface DocumentIdBody {
  docId: string;
}

export interface DocumentStateResponse {
  exists: boolean;
  status?: string;
  /** Code points of text received so far, and the total expected. */
  textLength: number;
  expectedLength: number;
  /** Text parts received so far. */
  parts: number;
  chunkCount: number;
  /** Ordinals of the chunks already stored. */
  ordinals: number[];
}

export interface DocumentTextResponse {
  text: string;
  pageOffsets?: number[];
}

export interface SearchBody {
  query: string;
  /** The chat's collections; empty means the whole knowledge base. */
  collectionIds: string[];
  limit: number;
}

export type SearchChunk = ChunkUpload & { docId: string };

export interface SearchHit {
  chunk: SearchChunk;
  docName: string;
  /** Reciprocal-rank-fusion score of the semantic and keyword rankings. */
  score: number;
  /** The chunks right before and after, for widening the excerpt. */
  neighbors: SearchChunk[];
}

export interface SearchResponse {
  hits: SearchHit[];
  /** False when the question couldn't be embedded, so only keyword search ran. */
  semantic: boolean;
}
