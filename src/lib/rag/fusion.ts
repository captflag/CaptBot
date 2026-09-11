export interface Ranked {
  id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion: merges ranked lists whose raw scores are not
 * comparable (BM25 vs cosine) using only rank positions.
 */
export function reciprocalRankFusion(lists: Ranked[][], k = 60): Ranked[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
