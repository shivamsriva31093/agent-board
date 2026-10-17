/**
 * sqlite-vec's vec0 KNN returns Euclidean (L2) distance. Embeddings are
 * normalized, so cosine similarity = 1 - d²/2. Clamped at 0: a negative
 * similarity would invert any weighting multiplied onto it.
 */
export function distanceToSimilarity(l2: number): number {
  return Math.max(0, 1 - (l2 * l2) / 2);
}
