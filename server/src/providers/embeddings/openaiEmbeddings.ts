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
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai';
  readonly isRemote = true;
  readonly dimensions: number;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {
    this.dimensions = KNOWN_DIMENSIONS[model] ?? 0;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];

    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const response = await withRetry(
        () => this.client.embeddings.create({ model: this.model, input: batch }),
        { label: 'embeddings.create', log },
      ).catch((error: unknown) => {
        throw new UpstreamError(
          `Embedding provider failed: ${error instanceof Error ? error.message : String(error)}`,
          { model: this.model, batchSize: batch.length },
        );
      });

      // The API guarantees ordering by `index`, but sorting makes that
      // assumption explicit rather than load-bearing and invisible.
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      if (ordered.length !== batch.length) {
        throw new UpstreamError('Embedding provider returned a truncated batch', {
          expected: batch.length,
          received: ordered.length,
        });
      }
      for (const entry of ordered) vectors.push(normalise(Float32Array.from(entry.embedding)));
    }

    return vectors;
  }
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
