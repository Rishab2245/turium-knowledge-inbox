import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './types.js';

const DIMENSIONS = 512;

/**
 * Zero-dependency fallback embedder, used when no API key is configured.
 *
 * It is a hashed bag-of-features model: word unigrams, word bigrams and
 * character 4-grams are hashed into a fixed 512-dimensional space with
 * sub-linear term weighting, then L2-normalised so cosine similarity is a
 * plain dot product.
 *
 * What it buys: the whole app clones, installs and runs with no credentials,
 * and retrieval still behaves sensibly for keyword-ish questions.
 * What it costs: no semantic generalisation. "car" and "automobile" land in
 * unrelated dimensions. Character n-grams recover morphology (run/running)
 * and typo tolerance, not synonymy. Set OPENAI_API_KEY for real semantics.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-hashed-ngram';
  readonly model = 'local-hashed-ngram-512';
  readonly dimensions = DIMENSIONS;
  readonly isRemote = false;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => embedOne(text));
  }
}

function embedOne(text: string): Float32Array {
  const vector = new Float32Array(DIMENSIONS);
  const normalised = text.toLowerCase().normalize('NFKD');
  const words = normalised.match(/[\p{L}\p{N}]+/gu) ?? [];

  // Term frequencies first, so weighting can be sub-linear (1 + log tf).
  // Raw counts let a single repeated word dominate the vector.
  const counts = new Map<number, number>();
  const bump = (feature: string, weight: number) => {
    const index = hashToIndex(feature);
    counts.set(index, (counts.get(index) ?? 0) + weight);
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    bump(`w:${word}`, 1);
    const next = words[i + 1];
    if (next) bump(`b:${word}_${next}`, 0.6);

    if (word.length > 4) {
      const padded = `^${word}$`;
      for (let j = 0; j + 4 <= padded.length; j += 1) {
        bump(`c:${padded.slice(j, j + 4)}`, 0.35);
      }
    }
  }

  for (const [index, count] of counts) {
    vector[index] = 1 + Math.log(count);
  }

  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i += 1) vector[i] = vector[i]! / magnitude;
  }
  return vector;
}

/** Deterministic across processes and restarts, unlike a JS string hash seed. */
function hashToIndex(feature: string): number {
  const digest = createHash('sha1').update(feature).digest();
  return digest.readUInt32BE(0) % DIMENSIONS;
}
