import type {
  AddChunksBody,
  AddChunksResponse,
  AppendTextBody,
  CreateDocumentBody,
  CreateDocumentResponse,
  DocumentStateResponse,
  DocumentTextResponse,
  PullResponse,
  PushResponse,
  RateLimitedBody,
  SearchBody,
  SearchResponse,
  StatusResponse,
  SyncChange,
  SyncCursors,
} from '../../../api/_lib/contract';
import { getAuthToken } from '../auth/session';
import { recordUsage } from '../auth/usage';
import { isAbort } from '../providers/http';
import { rateLimitMessage } from '../providers/server';
import { ProviderError, RateLimitError, SetupError } from '../providers/types';

/** The account knowledge base on the server (/api/data). */
export interface DataRemote {
  status(signal?: AbortSignal): Promise<StatusResponse>;
  pull(cursors: SyncCursors): Promise<PullResponse>;
  push(changes: SyncChange[]): Promise<PushResponse>;
  createDocument(body: CreateDocumentBody): Promise<CreateDocumentResponse>;
  appendText(body: AppendTextBody): Promise<void>;
  addChunks(body: AddChunksBody, signal?: AbortSignal): Promise<AddChunksResponse>;
  completeDocument(docId: string): Promise<void>;
  documentState(docId: string): Promise<DocumentStateResponse>;
  /** null when the document no longer exists. */
  documentText(docId: string, signal?: AbortSignal): Promise<DocumentTextResponse | null>;
  search(body: SearchBody, signal?: AbortSignal): Promise<SearchResponse>;
  wipe(): Promise<void>;
}

const LABEL = 'CaptBot server';
const SESSION_EXPIRED = 'Your session has expired. Sign in again.';

async function call<T>(op: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new SetupError(SESSION_EXPIRED);
  let res: Response;
  try {
    res = await fetch(`/api/data?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ProviderError('Could not reach the CaptBot server. Check your connection.', undefined, LABEL);
  }
  if (op === 'add-chunks') recordUsage('embed', res.headers);
  if (op === 'search') recordUsage('search', res.headers);
  const json = res.headers.get('content-type')?.includes('application/json');
  if (res.ok && json) return (await res.json()) as T;

  const detail = json ? ((await res.json().catch(() => null)) as (RateLimitedBody & { error?: unknown }) | null) : null;
  if (res.status === 429 && detail?.error === 'rate_limited') throw new RateLimitError(rateLimitMessage(detail), LABEL);
  if (res.status === 401) throw new SetupError(SESSION_EXPIRED);
  if (!json) throw new ProviderError('The CaptBot API is not running here.', res.status, LABEL);
  const message = typeof detail?.error === 'string' ? detail.error : `server error ${res.status}`;
  throw new ProviderError(message, res.status, LABEL);
}

export const httpRemote: DataRemote = {
  status: (signal) => call('status', {}, signal),
  pull: (cursors) => call('pull', { cursors }),
  push: (changes) => call('push', { changes }),
  createDocument: (body) => call('create-document', body),
  appendText: async (body) => {
    await call('append-text', body);
  },
  addChunks: (body, signal) => call('add-chunks', body, signal),
  completeDocument: async (docId) => {
    await call('complete-document', { docId });
  },
  documentState: (docId) => call('document-state', { docId }),
  documentText: async (docId, signal) => {
    try {
      return await call<DocumentTextResponse>('document-text', { docId }, signal);
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  },
  search: (body, signal) => call('search', body, signal),
  wipe: async () => {
    await call('wipe', {});
  },
};

/** Lets tests swap in an in-memory server. */
export const remoteOverride: { remote?: DataRemote } = {};

export const remote = (): DataRemote => remoteOverride.remote ?? httpRemote;
