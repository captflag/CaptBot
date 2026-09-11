import type {
  AddChunksResponse,
  AppendTextBody,
  ChunkUpload,
  CreateDocumentBody,
  CreateDocumentResponse,
  DocumentStateResponse,
  DocumentTextResponse,
  PullResponse,
  PushResponse,
  SearchChunk,
  SyncChange,
  SyncCursors,
} from './contract.js';

/** A chunk ready to store: its upload plus the context title and embedding the server computed. */
export interface StoredChunk extends ChunkUpload {
  title: string;
  embedding: number[];
}

export interface ScopedDocument {
  id: string;
  name: string;
}

export interface SearchParams {
  /** Ready documents in scope. */
  docIds: string[];
  /** The embedded question; null runs keyword search alone. */
  vector: number[] | null;
  /** Postgres tsquery text for the keyword half; empty skips it. */
  tsquery: string;
  limit: number;
}

export interface RankedChunk {
  chunk: SearchChunk;
  score: number;
}

/**
 * The account knowledge base. Every method is scoped to one user: implementations must
 * never read or write another user's rows, whatever ids the caller passes.
 */
export interface DataStore {
  pull(userId: string, cursors: SyncCursors): Promise<PullResponse>;
  /** Applies each change on its own; a change that can't be stored is reported, not fatal. */
  push(userId: string, changes: SyncChange[]): Promise<PushResponse>;
  createDocument(userId: string, body: CreateDocumentBody): Promise<CreateDocumentResponse>;
  appendText(userId: string, body: AppendTextBody): Promise<void>;
  /** The document's name, or null if it doesn't exist (or was deleted). */
  documentName(userId: string, docId: string): Promise<string | null>;
  addChunks(userId: string, docId: string, chunks: StoredChunk[], embeddingKey: string): Promise<AddChunksResponse>;
  completeDocument(userId: string, docId: string, embeddingKey: string): Promise<void>;
  documentState(userId: string, docId: string): Promise<DocumentStateResponse>;
  documentText(userId: string, docId: string): Promise<DocumentTextResponse | null>;
  /** Ready documents in the given collections (all of them when the list is empty). */
  scope(userId: string, collectionIds: string[]): Promise<ScopedDocument[]>;
  search(userId: string, params: SearchParams): Promise<RankedChunk[]>;
  neighbors(userId: string, positions: { docId: string; ordinal: number }[]): Promise<SearchChunk[]>;
  /** Deletes everything, leaving tombstones so the user's other devices clear their copies too. */
  wipe(userId: string): Promise<void>;
}
