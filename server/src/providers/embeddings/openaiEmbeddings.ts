import type OpenAI from 'openai';
import { UpstreamError } from '../../domain/errors.js';
import { loggerFor } from '../../lib/logger.js';
import { withRetry } from '../../lib/retry.js';
import type { EmbeddingProvider } from './types.js';

const log = loggerFor('embeddings.openai');

/** Batched to stay well under the per-request token ceiling of the endpoint. */
const BATCH_SIZE = 64;

const KNOWN_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'gemini-embedding-001': 3072,
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai';
  readonly isRemote = true;

  /**
   * Starts from the configured model's known size, but is corrected from the
   * first real response. A third-party OpenAI-compatible endpoint can serve a
   * model this map has never heard of, and leaving `dimensions` at 0 silently
   * disables the mismatch guard that stops two embedding spaces being mixed.
   */
  #dimensions: number;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    /** Some providers accept a reduced output size; only sent when configured. */
    private readonly requestedDimensions?: number,
  ) {
    this.#dimensions = requestedDimensions ?? KNOWN_DIMENSIONS[model] ?? 0;
  }

  get dimensions(): number {
    return this.#dimensions;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];

    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const response = await withRetry(
        () =>
          this.client.embeddings.create({
            model: this.model,
            input: batch,
            ...(this.requestedDimensions ? { dimensions: this.requestedDimensions } : {}),
          }),
        { label: 'embeddings.create', log },
      ).catch((error: unknown) => {
        throw new UpstreamError(
          `Embedding provider failed: ${error instanceof Error ? error.message : String(error)}`,
          { model: this.model, batchSize: batch.length },
        );
      });

      const ordered = orderByIndex(response.data);
      if (ordered.length !== batch.length) {
        throw new UpstreamError('Embedding provider returned a truncated batch', {
          expected: batch.length,
          received: ordered.length,
        });
      }

      for (const entry of ordered) vectors.push(normalise(Float32Array.from(entry.embedding)));
    }

    const actual = vectors[0]?.length;
    if (actual && actual !== this.#dimensions) {
      if (this.#dimensions !== 0) {
        log.warn(
          { model: this.model, expected: this.#dimensions, actual },
          'embedding provider returned a different dimension than expected; trusting the response',
        );
      }
      this.#dimensions = actual;
    }

    return vectors;
  }
}

/**
 * Restores request order from the response's `index` field.
 *
 * The subtlety that makes this worth a named function: Gemini's
 * OpenAI-compatible endpoint omits `index` entirely when it is 0, because
 * protobuf drops default values on the wire. A naive `a.index - b.index`
 * comparator then evaluates to NaN, and sorting with a NaN comparator is
 * unspecified. It happens to preserve order in V8, so it works by luck until
 * it does not, and the failure mode is silent: every chunk gets another
 * chunk's vector and the whole index is quietly wrong.
 *
 * A missing index therefore means 0, not "wherever this happened to arrive" -
 * 0 is precisely the value protobuf elided. Only one element can carry index 0,
 * so this cannot collide. A provider that omits every index leaves them all at
 * 0, and Array#sort has been stable since ES2019, so arrival order survives.
 */
function orderByIndex(data: Array<{ index?: number; embedding: number[] }>): Array<{ embedding: number[] }> {
  return data
    .map((entry) => ({
      embedding: entry.embedding,
      index: typeof entry.index === 'number' && Number.isFinite(entry.index) ? entry.index : 0,
    }))
    .sort((a, b) => a.index - b.index);
}

/**
 * OpenAI vectors arrive unit-length, but a self-hosted OpenAI-compatible
 * endpoint may not normalise. Normalising here lets the search layer treat
 * cosine similarity as a dot product unconditionally.
 */
function normalise(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return vector;
  for (let i = 0; i < vector.length; i += 1) vector[i] = vector[i]! / magnitude;
  return vector;
}
