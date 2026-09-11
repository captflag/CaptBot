import { useSyncExternalStore } from 'react';
import type { EmbedInput, Embedder } from './types';

export const LOCAL_RERANKER = 'Xenova/ms-marco-MiniLM-L-6-v2';
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

export interface LocalModelStatus {
  model: string;
  state: 'downloading' | 'ready' | 'error';
  progress: number;
}

type WorkerMessage =
  | { type: 'progress'; model: string; progress: number }
  | { type: 'ready'; model: string }
  | { type: 'result'; id: number; result?: unknown; error?: string };

class LocalModels {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; model: string }>();
  private status = new Map<string, LocalModelStatus>();
  private snapshot: LocalModelStatus[] = [];
  private listeners = new Set<() => void>();

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../../workers/localModels.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => this.onMessage(e.data);
    worker.onerror = (e) => {
      const error = new Error(e.message || 'Local model worker crashed');
      for (const [, p] of this.pending) p.reject(error);
      this.pending.clear();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private onMessage(msg: WorkerMessage) {
    if (msg.type === 'progress') {
      this.setStatus({ model: msg.model, state: 'downloading', progress: msg.progress });
    } else if (msg.type === 'ready') {
      this.setStatus({ model: msg.model, state: 'ready', progress: 100 });
    } else {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        if (this.status.get(p.model)?.state !== 'ready') this.setStatus({ model: p.model, state: 'error', progress: 0 });
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private setStatus(s: LocalModelStatus) {
    this.status.set(s.model, s);
    this.snapshot = [...this.status.values()];
    this.listeners.forEach((l) => l());
  }

  private call<T>(payload: { type: 'embed'; model: string; texts: string[] } | { type: 'rerank'; model: string; query: string; passages: string[] }, signal?: AbortSignal): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, model: payload.model });
      this.getWorker().postMessage({ id, ...payload });
    });
  }

  async embed(model: string, texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const rows = await this.call<number[][]>({ type: 'embed', model, texts }, signal);
    return rows.map((r) => Float32Array.from(r));
  }

  rerank(model: string, query: string, passages: string[], signal?: AbortSignal): Promise<number[]> {
    return this.call<number[]>({ type: 'rerank', model, query, passages }, signal);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;
}

export const localModels = new LocalModels();

export function useLocalModelStatus(): LocalModelStatus[] {
  return useSyncExternalStore(localModels.subscribe, localModels.getSnapshot);
}

export class LocalEmbedder implements Embedder {
  readonly key: string;
  readonly batchSize = 16;

  constructor(
    private readonly model: string,
    dimensions: number,
  ) {
    this.key = `local:${model}:${dimensions}`;
  }

  embedDocuments(docs: EmbedInput[], signal?: AbortSignal) {
    return localModels.embed(
      this.model,
      docs.map((d) => `${d.title}\n\n${d.text}`),
      signal,
    );
  }

  async embedQuery(query: string, signal?: AbortSignal) {
    const [vector] = await localModels.embed(this.model, [BGE_QUERY_PREFIX + query], signal);
    return vector;
  }
}
