/**
 * Every vector in this system is L2-normalised at the provider boundary, so
 * cosine similarity reduces to a dot product. Keeping that invariant in one
 * place means the hot loop is a single multiply-accumulate.
 */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

export const cosineSimilarity = dot;

/**
 * Maximal Marginal Relevance.
 *
 * Pure top-k on a sliding-window index tends to return near-duplicate
 * neighbouring chunks from one document, which wastes context and makes the
 * answer cite the same source three times. MMR re-ranks candidates by
 * `lambda * relevance - (1 - lambda) * maxSimilarityToAlreadyPicked`, trading a
 * little relevance for coverage across sources.
 */
export function maximalMarginalRelevance<T>(
  candidates: Array<{ item: T; score: number; embedding: Float32Array }>,
  k: number,
  lambda = 0.7,
): Array<{ item: T; score: number }> {
  const remaining = [...candidates].sort((a, b) => b.score - a.score);
  const selected: Array<{ item: T; score: number; embedding: Float32Array }> = [];

  while (selected.length < k && remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      let maxOverlap = 0;
      for (const picked of selected) {
        const overlap = dot(candidate.embedding, picked.embedding);
        if (overlap > maxOverlap) maxOverlap = overlap;
      }
      const value = lambda * candidate.score - (1 - lambda) * maxOverlap;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  // Report the original relevance score, not the MMR objective - the objective
  // is a ranking device and would be confusing in an API response.
  return selected.map(({ item, score }) => ({ item, score }));
}
