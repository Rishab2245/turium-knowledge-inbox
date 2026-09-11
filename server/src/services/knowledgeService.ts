import { config } from '../config/index.js';
import type { ChunkRepository } from '../db/chunkRepository.js';
import type { ItemRepository } from '../db/itemRepository.js';
import type { JobRepository } from '../db/jobRepository.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import type { Answer, Item, ItemStatus, ScoredChunk } from '../domain/types.js';
import type { IngestionQueue } from '../ingestion/queue.js';
import { loggerFor } from '../lib/logger.js';
import { emptyAnswer, type Answerer } from '../rag/answerer.js';
import type { Retriever } from '../rag/retriever.js';

const log = loggerFor('service.knowledge');

export interface IngestNoteInput {
  type: 'note';
  content: string;
  title?: string;
}

export interface IngestUrlInput {
  type: 'url';
  url: string;
  title?: string;
}

export type IngestInput = IngestNoteInput | IngestUrlInput;

export interface IngestResult {
  item: Item;
  jobId: string;
  deduplicated: boolean;
}

export interface QueryResult {
  question: string;
  answer: Answer;
  sources: ScoredChunk[];
  retrieval: { scannedChunks: number; latencyMs: number; topK: number };
}

/**
 * Application layer. HTTP handlers stay thin by delegating here, which keeps
 * the use cases testable without a server and makes the transport swappable.
 */
export class KnowledgeService {
  constructor(
    private readonly items: ItemRepository,
    private readonly chunks: ChunkRepository,
    private readonly jobs: JobRepository,
    private readonly queue: IngestionQueue,
    private readonly retriever: Retriever,
    private readonly answerer: Answerer,
  ) {}

  /**
   * Accepts content and returns immediately. The expensive part (fetching a
   * URL, embedding chunks) happens on the queue, so the caller gets a 202 and
   * an item it can poll rather than a request that hangs for ten seconds.
   */
  ingest(input: IngestInput, requestId?: string): IngestResult {
    if (input.type === 'url') {
      const existing = this.items.findByUrl(input.url);
      if (existing && existing.status !== 'failed') {
        log.info({ itemId: existing.id, url: input.url }, 'url already ingested, returning existing item');
        return { item: existing, jobId: '', deduplicated: true };
      }
    }

    const item =
      input.type === 'note'
        ? this.items.create({
            sourceType: 'note',
            title: input.title?.trim() || deriveNoteTitle(input.content),
            url: null,
            content: input.content,
          })
        : this.items.create({
            sourceType: 'url',
            title: input.title?.trim() || input.url,
            url: input.url,
            content: '',
          });

    const jobId = this.queue.enqueue(item.id, requestId);
    return { item, jobId, deduplicated: false };
  }

  listItems(options: { limit: number; status?: ItemStatus; cursor?: string }) {
    return this.items.list(options);
  }

  getItem(id: string): Item {
    const item = this.items.getById(id);
    if (!item) throw new NotFoundError('Item', id);
    return item;
  }

  getItemChunks(id: string) {
    this.getItem(id); // 404 rather than an empty list for an unknown id
    return this.chunks.listForItem(id);
  }

  deleteItem(id: string): void {
    if (!this.items.delete(id)) throw new NotFoundError('Item', id);
    log.info({ itemId: id }, 'item deleted');
  }

  async query(question: string, options: { topK?: number; itemIds?: string[] } = {}): Promise<QueryResult> {
    const trimmed = question.trim();
    if (trimmed.length === 0) throw new ValidationError('A question is required');

    const topK = options.topK ?? config.RETRIEVAL_TOP_K;
    const retrieval = await this.retriever.retrieve(trimmed, { topK, itemIds: options.itemIds });

    if (retrieval.chunks.length === 0) {
      const reason =
        this.chunks.count() === 0
          ? 'Nothing has been indexed yet. Save a note or a URL first, then ask again.'
          : 'No saved content was relevant enough to answer that. Try rephrasing, or save a source that covers it.';

      log.info({ question: trimmed, scanned: retrieval.scannedChunks }, 'query matched no chunks');
      return {
        question: trimmed,
        answer: emptyAnswer(reason),
        sources: [],
        retrieval: { scannedChunks: retrieval.scannedChunks, latencyMs: retrieval.latencyMs, topK },
      };
    }

    const answer = await this.answerer.answer(trimmed, retrieval.chunks);

    log.info(
      {
        question: trimmed,
        retrieved: retrieval.chunks.length,
        cited: answer.citations.length,
        generator: answer.generator,
        retrievalMs: retrieval.latencyMs,
        answerMs: answer.latencyMs,
      },
      'query answered',
    );

    return {
      question: trimmed,
      answer,
      sources: retrieval.chunks,
      retrieval: { scannedChunks: retrieval.scannedChunks, latencyMs: retrieval.latencyMs, topK },
    };
  }

  stats() {
    return {
      items: this.items.countByStatus(),
      chunks: this.chunks.count(),
      pendingJobs: this.jobs.pendingCount(),
      embeddingDimensions: this.chunks.storedDimension(),
    };
  }
}

/** First line of a note, trimmed to something that reads as a title. */
function deriveNoteTitle(content: string): string {
  const firstLine = content.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return 'Untitled note';
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77).trimEnd()}...`;
}
