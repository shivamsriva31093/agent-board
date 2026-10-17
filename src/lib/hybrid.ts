/**
 * Hybrid search helpers: a lexical (FTS5/BM25) query built from free text,
 * and reciprocal-rank fusion to merge it with vector search. Embeddings
 * blur long, identifier-heavy posts toward their topic; BM25 keeps exact
 * names, errors and paths findable, while vectors still catch paraphrases.
 */

/** FTS5 query matching any of the query's words; each is quoted so punctuation can't become FTS syntax. */
export function toFtsQuery(query: string): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  return [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
}

/**
 * Reciprocal-rank fusion: each id scores the sum of 1 / (k + rank) over the
 * lists it appears in (rank starts at 1). A small k lets top hits dominate.
 */
export function fuseRanks(lists: number[][], k = 10): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
