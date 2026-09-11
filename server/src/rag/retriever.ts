import { config } from '../config/index.js';
import type { ChunkRepository, ChunkWithEmbedding } from '../db/chunkRepository.js';
import type { ScoredChunk } from '../domain/types.js';
import { loggerFor } from '../lib/logger.js';
import type { EmbeddingProvider } from '../providers/index.js';
import { dot, maximalMarginalRelevance } from './similarity.js';

const log = loggerFor('rag.retriever');

export interface RetrievalOptions {
  topK?: number;
  minScore?: number;
  /** Restrict the search to specific items, e.g. "ask this document". */
  itemIds?: string[];
}

export interface RetrievalResult {
  chunks: ScoredChunk[];
  scannedChunks: number;
  latencyMs: number;
}

/**
 * Exact brute-force vector search.
 *
 * Chosen over an ANN index (hnswlib, faiss, pgvector) on purpose: at inbox
 * scale a linear scan is a few milliseconds, returns exact results, adds no
 * native dependency and needs no index build or tuning. The README records the
 * crossover point and the migration path.
 */
export class Retriever {
  constructor(
    private readonly chunks: ChunkRepository,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async retrieve(question: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const topK = options.topK ?? config.RETRIEVAL_TOP_K;
    const minScore = options.minScore ?? config.MIN_RELEVANCE_SCORE;

    let pool = this.chunks.loadAllForSearch();
    if (options.itemIds?.length) {
      const allowed = new Set(options.itemIds);
      pool = pool.filter((chunk) => allowed.has(chunk.itemId));
    }

    if (pool.length === 0) {
      return { chunks: [], scannedChunks: 0, latencyMs: Date.now() - startedAt };
    }

    const [queryVector] = await this.embeddings.embed([question]);
    if (!queryVector) throw new Error('Embedding provider returned no vector for the query');

    const usable = pool.filter((chunk) => chunk.embedding.length === queryVector.length);
    if (usable.length !== pool.length) {
      log.warn(
        { skipped: pool.length - usable.length, queryDim: queryVector.length },
        'skipped chunks embedded with a different model - re-index to search them',
      );
    }

    const scored = usable
      .map((chunk) => ({ item: chunk, score: dot(queryVector, chunk.embedding), embedding: chunk.embedding }))
      .filter((candidate) => candidate.score >= minScore);

    // Over-fetch, then let MMR pick a diverse subset from the candidate pool.
    const candidates = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK * config.RETRIEVAL_CANDIDATE_MULTIPLIER);

    const selected = maximalMarginalRelevance<ChunkWithEmbedding>(candidates, topK);

    log.debug(
      { scanned: usable.length, aboveThreshold: scored.length, returned: selected.length, topScore: candidates[0]?.score },
      'retrieval complete',
    );

    return {
      chunks: selected.map(({ item, score }) => this.chunks.toScored(item, round(score))),
      scannedChunks: usable.length,
      latencyMs: Date.now() - startedAt,
    };
  }
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
