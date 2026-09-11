export type ChatProviderId = 'gemini' | 'openai' | 'anthropic' | 'compatible';
export type EmbeddingProviderId = 'gemini' | 'openai' | 'compatible' | 'local';
export type RerankMode = 'none' | 'local' | 'llm';

export interface ImageAttachment {
  name: string;
  mimeType: string;
  /** base64, no data: prefix */
  data: string;
}

export interface Collection {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export type DocStatus = 'queued' | 'parsing' | 'embedding' | 'ready' | 'error';

export interface KbDocument {
  id: string;
  name: string;
  sourceType: 'file' | 'url' | 'text';
  mimeType: string;
  url?: string;
  hash: string;
  collectionIds: string[];
  charCount: number;
  chunkCount: number;
  pageCount?: number;
  status: DocStatus;
  /** 0..1 while embedding */
  progress: number;
  error?: string;
  /** provider:model:dimensions the stored vectors were made with */
  embeddingKey?: string;
  createdAt: number;
  updatedAt: number;
}

/** Full extracted text, kept apart from KbDocument so document lists stay light. */
export interface DocText {
  docId: string;
  text: string;
  /** Start offset of each page in `text` (PDFs only). */
  pageOffsets?: number[];
}

export interface Chunk {
  id: string;
  docId: string;
  ordinal: number;
  /** Character span of this chunk inside DocText.text */
  start: number;
  end: number;
  text: string;
  headingPath: string[];
  page?: number;
  pageEnd?: number;
  /** Context the span needs but doesn't contain, such as a split table's header rows. */
  prefix?: string;
}

export interface ChunkVector {
  chunkId: string;
  docId: string;
  embeddingKey: string;
  vector: Float32Array;
}

export interface Thread {
  id: string;
  title: string;
  /** Collections this chat searches; empty means the whole knowledge base. */
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SourceRef {
  n: number;
  chunkId: string;
  docId: string;
  docName: string;
  headingPath: string[];
  page?: number;
  start: number;
  end: number;
  text: string;
  score: number;
  /** Shown to the model before the text, e.g. the header rows of a split table. */
  prefix?: string;
}

export interface WebSource {
  title: string;
  uri: string;
}

export interface ResearchStep {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface RetrievalTrace {
  /** The query that was actually searched (after follow-up rewriting). */
  query: string;
  rewritten: boolean;
  candidates: number;
  reranker: RerankMode;
  /** Candidates the reranker judged irrelevant and left out. */
  dropped?: number;
  ms: number;
  warning?: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  images?: ImageAttachment[];
  mode?: 'chat' | 'research';
  /** On user messages: web search was requested, so a regenerate repeats it. */
  webSearch?: boolean;
  sources?: SourceRef[];
  webSources?: WebSource[];
  steps?: ResearchStep[];
  trace?: RetrievalTrace;
  model?: string;
  pinned?: boolean;
  error?: string;
  aborted?: boolean;
}

export interface SavedPrompt {
  id: string;
  text: string;
  createdAt: number;
}
