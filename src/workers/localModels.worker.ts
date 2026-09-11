/// <reference lib="webworker" />
/**
 * Runs transformers.js models off the main thread: a sentence-embedding model
 * for fully local indexing and a cross-encoder for reranking.
 */
import { AutoModelForSequenceClassification, AutoTokenizer, env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

type Request =
  | { id: number; type: 'embed'; model: string; texts: string[] }
  | { id: number; type: 'rerank'; model: string; query: string; passages: string[] };

// transformers.js pipeline/model types are very wide; keep the surface we use explicit.
type Extractor = (texts: string[], opts: { pooling: 'cls' | 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
interface Reranker {
  tokenizer: (a: string[], opts: { text_pair: string[]; padding: boolean; truncation: boolean }) => unknown;
  model: (inputs: unknown) => Promise<{ logits: { sigmoid(): { tolist(): number[][] } } }>;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const extractors = new Map<string, Promise<Extractor>>();
const rerankers = new Map<string, Promise<Reranker>>();

function onProgress(model: string) {
  return (p: { status: string; progress?: number; file?: string }) => {
    if (p.status === 'progress') scope.postMessage({ type: 'progress', model, progress: p.progress ?? 0, file: p.file });
  };
}

function getExtractor(model: string): Promise<Extractor> {
  let e = extractors.get(model);
  if (!e) {
    e = pipeline('feature-extraction', model, { dtype: 'q8', progress_callback: onProgress(model) }) as unknown as Promise<Extractor>;
    e.then(() => scope.postMessage({ type: 'ready', model })).catch(() => extractors.delete(model));
    extractors.set(model, e);
  }
  return e;
}

function getReranker(model: string): Promise<Reranker> {
  let r = rerankers.get(model);
  if (!r) {
    r = (async () => {
      const [tokenizer, clf] = await Promise.all([
        AutoTokenizer.from_pretrained(model, { progress_callback: onProgress(model) }),
        AutoModelForSequenceClassification.from_pretrained(model, { dtype: 'q8', progress_callback: onProgress(model) }),
      ]);
      scope.postMessage({ type: 'ready', model });
      return { tokenizer, model: clf } as unknown as Reranker;
    })();
    r.catch(() => rerankers.delete(model));
    rerankers.set(model, r);
  }
  return r;
}

async function handle(req: Request): Promise<unknown> {
  if (req.type === 'embed') {
    const extract = await getExtractor(req.model);
    // BGE models are trained with CLS pooling.
    const output = await extract(req.texts, { pooling: 'cls', normalize: true });
    return output.tolist();
  }
  const { tokenizer, model } = await getReranker(req.model);
  const scores: number[] = [];
  for (let i = 0; i < req.passages.length; i += 16) {
    const batch = req.passages.slice(i, i + 16);
    const inputs = tokenizer(new Array(batch.length).fill(req.query), { text_pair: batch, padding: true, truncation: true });
    const { logits } = await model(inputs);
    for (const row of logits.sigmoid().tolist()) scores.push(row[0]);
  }
  return scores;
}

scope.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    scope.postMessage({ type: 'result', id: req.id, result: await handle(req) });
  } catch (err) {
    scope.postMessage({ type: 'result', id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
