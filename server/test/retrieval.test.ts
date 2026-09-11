import { describe, expect, it } from 'vitest';
import { LocalEmbeddingProvider } from '../src/providers/embeddings/localEmbeddings.js';
import { dot, maximalMarginalRelevance } from '../src/rag/similarity.js';
import { decodeEmbedding, encodeEmbedding } from '../src/db/chunkRepository.js';

const unit = (values: number[]) => {
  const vector = Float32Array.from(values);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / magnitude) as Float32Array;
};

describe('dot', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal ones', () => {
    const a = unit([1, 0, 0]);
    const b = unit([0, 1, 0]);
    expect(dot(a, a)).toBeCloseTo(1, 5);
    expect(dot(a, b)).toBeCloseTo(0, 5);
  });

  it('refuses to compare vectors from different embedding spaces', () => {
    expect(() => dot(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0]))).toThrow(/dimension mismatch/);
  });
});

describe('maximalMarginalRelevance', () => {
  it('prefers a slightly less relevant result over a near-duplicate of one already picked', () => {
    const duplicate = unit([1, 0, 0]);
    const diverse = unit([0, 1, 0]);

    const picked = maximalMarginalRelevance(
      [
        { item: 'a', score: 0.9, embedding: duplicate },
        { item: 'a-copy', score: 0.89, embedding: duplicate },
        { item: 'b', score: 0.6, embedding: diverse },
      ],
      2,
      0.7,
    );

    expect(picked.map((entry) => entry.item)).toEqual(['a', 'b']);
  });

  it('always takes the most relevant candidate first', () => {
    const picked = maximalMarginalRelevance(
      [
        { item: 'low', score: 0.2, embedding: unit([1, 0]) },
        { item: 'high', score: 0.95, embedding: unit([0, 1]) },
      ],
      1,
    );
    expect(picked[0]!.item).toBe('high');
  });

  it('returns everything it has when asked for more than exists', () => {
    expect(maximalMarginalRelevance([{ item: 'only', score: 1, embedding: unit([1, 0]) }], 5)).toHaveLength(1);
  });
});

describe('LocalEmbeddingProvider', () => {
  const provider = new LocalEmbeddingProvider();

  it('is deterministic across calls', async () => {
    const [first] = await provider.embed(['retrieval augmented generation']);
    const [second] = await provider.embed(['retrieval augmented generation']);
    expect(Array.from(first!)).toEqual(Array.from(second!));
  });

  it('produces unit-length vectors so cosine reduces to a dot product', async () => {
    const [vector] = await provider.embed(['some text about sqlite and vectors']);
    expect(dot(vector!, vector!)).toBeCloseTo(1, 4);
  });

  it('scores a matching passage above an unrelated one', async () => {
    const [query, relevant, unrelated] = await provider.embed([
      'how does the vector store work',
      'The vector store keeps embeddings in SQLite and scans them to find matches.',
      'Banana bread needs ripe bananas, flour and about an hour in the oven.',
    ]);

    expect(dot(query!, relevant!)).toBeGreaterThan(dot(query!, unrelated!));
  });

  it('preserves batch order', async () => {
    const vectors = await provider.embed(['alpha', 'beta', 'gamma']);
    const [alphaAlone] = await provider.embed(['alpha']);
    expect(Array.from(vectors[0]!)).toEqual(Array.from(alphaAlone!));
  });
});

describe('embedding blob round-trip', () => {
  it('survives encode then decode intact', () => {
    const original = unit([0.1, -0.4, 0.9, 0.2]);
    const restored = decodeEmbedding(encodeEmbedding(original));
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});
