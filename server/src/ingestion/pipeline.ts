import { config } from '../config/index.js';
import type { ChunkRepository } from '../db/chunkRepository.js';
import type { ItemRepository } from '../db/itemRepository.js';
import { UnprocessableError } from '../domain/errors.js';
import { loggerFor } from '../lib/logger.js';
import type { EmbeddingProvider } from '../providers/index.js';
import { chunkText } from './chunker.js';
import { fetchPageContent } from './urlFetcher.js';

const log = loggerFor('ingestion.pipeline');

export interface PipelineResult {
  itemId: string;
  chunkCount: number;
  charCount: number;
}

/**
 * The work performed for one ingested item: resolve content, chunk it, embed
 * the chunks, store them.
 *
 * Kept separate from the queue so it can be unit-tested and, later, moved to a
 * different executor (a separate worker process, a Lambda) without changes.
 * Idempotent per item: re-running replaces the item's chunks wholesale.
 */
export class IngestionPipeline {
  constructor(
    private readonly items: ItemRepository,
    private readonly chunks: ChunkRepository,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async run(itemId: string): Promise<PipelineResult> {
    const item = this.items.getById(itemId);
    if (!item) throw new UnprocessableError(`Item '${itemId}' disappeared before it could be processed`);

    this.items.markProcessing(itemId);
    const startedAt = Date.now();

    let content = item.content;
    let title: string | undefined;

    if (item.sourceType === 'url') {
      if (!item.url) throw new UnprocessableError(`Item '${itemId}' is a URL item with no URL`);
      const page = await fetchPageContent(item.url);
      content = page.text;
      // Only overwrite the placeholder title, never a title the user typed.
      if (!item.title || item.title === item.url) title = page.title;
    }

    const textChunks = chunkText(content, {
      maxChars: config.CHUNK_SIZE_CHARS,
      overlapChars: config.CHUNK_OVERLAP_CHARS,
    });

    if (textChunks.length === 0) {
      throw new UnprocessableError('Nothing to index - the content was empty after normalisation');
    }

    this.assertEmbeddingSpaceMatches();

    const vectors = await this.embeddings.embed(textChunks.map((chunk) => chunk.content));
    if (vectors.length !== textChunks.length) {
      throw new UnprocessableError('Embedding provider returned a different number of vectors than chunks', {
        chunks: textChunks.length,
        vectors: vectors.length,
      });
    }

    const stored = this.chunks.replaceForItem(
      itemId,
      textChunks.map((chunk, index) => ({
        position: chunk.position,
        content: chunk.content,
        embedding: vectors[index]!,
      })),
      this.embeddings.model,
    );

    this.items.markReady(itemId, { title, content, chunkCount: stored });

    log.info(
      { itemId, sourceType: item.sourceType, chunkCount: stored, chars: content.length, durationMs: Date.now() - startedAt },
      'item indexed',
    );

    return { itemId, chunkCount: stored, charCount: content.length };
  }

  /**
   * Vectors from two different embedding models are not comparable, and mixing
   * them silently degrades every search result. Fail loudly instead.
   */
  private assertEmbeddingSpaceMatches(): void {
    const storedDim = this.chunks.storedDimension();
    if (storedDim === null || this.embeddings.dimensions === 0) return;
    if (storedDim !== this.embeddings.dimensions) {
      throw new UnprocessableError(
        `The index holds ${storedDim}-dimension vectors but the configured embedding model produces ` +
          `${this.embeddings.dimensions}. Re-index (delete the database file) before switching models.`,
        { storedDimensions: storedDim, providerDimensions: this.embeddings.dimensions },
      );
    }
  }
}
