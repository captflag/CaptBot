import type { SourceRef } from '../types';

/** One retrieval check: a question, and a phrase only the passage that answers it contains. */
export interface EvalCase {
  question: string;
  expect: string;
}

export interface EvalReport {
  /** Share of questions whose answering passage is among the sources. */
  recall: number;
  /** Mean reciprocal rank of the first source containing the answer (0 when it's missing). */
  mrr: number;
  /** Questions whose answer wasn't found. */
  misses: string[];
}

/** Scores retrieval over a set of cases, given the sources returned for each question, in case order. */
export function scoreRetrieval(cases: EvalCase[], results: SourceRef[][]): EvalReport {
  let found = 0;
  let reciprocal = 0;
  const misses: string[] = [];
  cases.forEach((c, i) => {
    const needle = c.expect.toLowerCase();
    const rank = results[i].findIndex((s) => s.text.toLowerCase().includes(needle));
    if (rank === -1) {
      misses.push(c.question);
    } else {
      found++;
      reciprocal += 1 / (rank + 1);
    }
  });
  return { recall: found / cases.length, mrr: reciprocal / cases.length, misses };
}
