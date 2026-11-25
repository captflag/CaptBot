/**
 * Retrieval quality: a small, realistic knowledge base and questions with known answers.
 * Runs offline with a bag-of-words embedder and a keyword-overlap stand-in for the
 * cross-encoder, so it guards the pipeline's plumbing (chunking, hybrid search, fusion,
 * reranking, filtering, widening) against regressions rather than measuring the real models.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, scopedReadyDocIds } from '../db';
import { providerOverrides } from '../providers';
import type { ChatProvider, EmbedInput, Embedder } from '../providers/types';
import { getSettings, updateSettings } from '../settings';
import type { SourceRef } from '../types';
import { scoreRetrieval, type EvalCase } from './eval';
import { ingest } from './ingest';
import { buildSources, retrieve } from './retrieve';
import { knowledge } from './store';

const STOP = new Set('the and are for how what who does with from that this can our any after before much many long when where which'.split(' '));
const terms = (s: string) =>
  new Set((s.toLowerCase().match(/[a-z0-9%.,:]{3,}/g) ?? []).map((t) => t.replace(/[.,:]+$/, '')).filter((t) => t.length > 2 && !STOP.has(t)));

class HashEmbedder implements Embedder {
  readonly key = 'test:hash:512';
  readonly batchSize = 8;
  private vec(text: string) {
    const v = new Float32Array(512);
    for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      let h = 7;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % 512] += 1;
    }
    return v;
  }
  async embedDocuments(docs: EmbedInput[]) {
    return docs.map((d) => this.vec(`${d.title} ${d.text}`));
  }
  async embedQuery(q: string) {
    return this.vec(q);
  }
}

const chat: ChatProvider = {
  id: 'gemini',
  supportsWebSearch: false,
  async *stream() {
    yield { text: '' };
  },
};

const CORPUS: Record<string, string> = {
  'handbook.md': `# Employee handbook

## Annual leave
Full-time employees receive 24 days of paid annual leave each calendar year, plus public holidays. Up to five unused days can be carried over into the next year; anything beyond that is forfeited on 31 March.

## Remote work
Staff may work remotely up to three days a week once their probation period ends. Core collaboration hours are 11:00 to 16:00 India Standard Time, when everyone should be reachable on chat.

## Expenses
Submit expense claims with itemised receipts within 30 days of purchase. Claims above 10,000 INR need approval from the finance director before they are reimbursed.`,

  'refund-policy.md': `# Refund policy

Customers can request a full refund within 30 days of purchase by contacting support with their order number. After 30 days and up to 90 days, we offer store credit instead of a refund.

## Digital products
Digital downloads such as e-books and software licences are non-refundable once the file has been downloaded or the licence key revealed.`,

  'q3-review.md': `# Q3 2026 business review

Revenue grew 18% quarter on quarter to 4.2 million USD, driven by the enterprise plan. Customer churn fell to 2.1%, the lowest in two years.

## Revenue by region

| Region | Q2 revenue | Q3 revenue | Growth |
| --- | --- | --- | --- |
| India | 1.1M | 1.4M | 27% |
| Europe | 1.3M | 1.5M | 15% |
| North America | 1.2M | 1.3M | 8% |`,

  'security.md': `# Security policy

## Passwords
Passwords must be at least 14 characters and are rotated every 90 days. Multi-factor authentication is required for email, the VPN and all admin consoles.

## Incidents
Report suspected security incidents to the security team within 24 hours, even if you are unsure. Lost or stolen laptops count as incidents.

## Devices
Company laptops must use full-disk encryption and lock automatically after five minutes of inactivity.`,

  'onboarding.md': `# Onboarding guide

On your first day, collect your laptop from the IT desk on the ground floor and your access badge from reception on floor 2. Your manager assigns a buddy who will walk you through our tools during the first week.`,
};

const CASES: EvalCase[] = [
  { question: 'How many days of paid annual leave do employees get?', expect: '24 days of paid annual leave' },
  { question: 'Can unused leave days be carried over?', expect: 'carried over' },
  { question: 'How many days per week can staff work remotely?', expect: 'three days a week' },
  { question: 'What are the core collaboration hours?', expect: '11:00 to 16:00' },
  { question: 'Who approves expense claims above 10,000 INR?', expect: 'finance director' },
  { question: 'How long do customers have to request a full refund?', expect: 'full refund within 30 days' },
  { question: 'Are digital downloads refundable?', expect: 'non-refundable' },
  { question: 'What do customers get between 30 and 90 days after purchase?', expect: 'store credit' },
  { question: 'How much did revenue grow in Q3?', expect: 'grew 18%' },
  { question: 'What was customer churn in Q3?', expect: 'churn fell to 2.1%' },
  { question: 'Which region had the highest revenue growth?', expect: '| India |' },
  { question: 'How often are passwords rotated?', expect: 'rotated every 90 days' },
  { question: 'Is multi-factor authentication required?', expect: 'multi-factor authentication is required' },
  { question: 'How quickly must security incidents be reported?', expect: 'within 24 hours' },
  { question: 'Must company laptops be encrypted?', expect: 'full-disk encryption' },
  { question: 'Where do new employees collect their access badge?', expect: 'reception on floor 2' },
];

async function sourcesFor(question: string): Promise<SourceRef[]> {
  const settings = getSettings();
  const res = await retrieve({
    query: question,
    docIds: await scopedReadyDocIds([]),
    collectionIds: [],
    embedder: providerOverrides.embedder!,
    embeddingKey: providerOverrides.embedder!.key,
    chat,
    settings,
  });
  return buildSources(res.results, settings.retrieval.contextTokens);
}

beforeAll(async () => {
  providerOverrides.embedder = new HashEmbedder();
  providerOverrides.chat = chat;
  // Stand-in cross-encoder: relevance grows with the share of query terms a passage contains.
  providerOverrides.reranker = async (query, passages) => {
    const q = terms(query);
    return passages.map((p) => {
      const t = terms(p);
      const shared = [...q].filter((w) => t.has(w)).length;
      return shared ? Math.min(0.99, 0.2 + (0.8 * shared) / Math.max(1, q.size)) : 0.002;
    });
  };
  updateSettings({ retrieval: { ...getSettings().retrieval, rerank: 'local', filterIrrelevant: true, topK: 8 } });
  await Promise.all(db.tables.map((t) => t.clear()));
  knowledge.invalidate();
  for (const [name, text] of Object.entries(CORPUS)) await ingest({ kind: 'text', name, text });
});

afterAll(() => {
  delete providerOverrides.embedder;
  delete providerOverrides.chat;
  delete providerOverrides.reranker;
});

describe('retrieval quality', () => {
  it('finds the answering passage for nearly every question, usually first', async () => {
    const results: SourceRef[][] = [];
    for (const c of CASES) results.push(await sourcesFor(c.question));
    const report = scoreRetrieval(CASES, results);
    expect(report.misses, `missed: ${report.misses.join(' | ')}`).toEqual([]);
    expect(report.recall).toBe(1);
    expect(report.mrr).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps a table and its header together in the excerpt', async () => {
    const [top] = await sourcesFor('Which region had the highest revenue growth?');
    expect(top.text).toContain('| Region | Q2 revenue | Q3 revenue | Growth |');
    expect(top.text).toContain('| India | 1.1M | 1.4M | 27% |');
  });

  it('returns no sources for a question the documents do not cover', async () => {
    expect(await sourcesFor('What is the capital of Mongolia?')).toEqual([]);
  });
});
