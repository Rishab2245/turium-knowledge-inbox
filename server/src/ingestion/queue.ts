import { EventEmitter } from 'node:events';
import { config } from '../config/index.js';
import type { ItemRepository } from '../db/itemRepository.js';
import type { JobRepository } from '../db/jobRepository.js';
import { AppError } from '../domain/errors.js';
import { loggerFor, requestContext } from '../lib/logger.js';
import type { IngestionPipeline } from './pipeline.js';

const log = loggerFor('ingestion.queue');

/**
 * In-process async job runner backed by the `ingest_jobs` table.
 *
 * Why a queue at all: fetching a URL and embedding its chunks takes seconds and
 * depends on two external services. Doing it inside the POST /ingest request
 * would make the endpoint slow, failure-prone and untestable, and would tie the
 * work's lifetime to an HTTP connection the client may abandon. So /ingest
 * returns 202 with a `pending` item and the UI polls until it is `ready`.
 *
 * Why in-process rather than BullMQ/SQS: the assignment asks for one service
 * with no infra theatre. Job *state* still lives in SQLite, not in memory, so a
 * crash mid-ingest is recoverable rather than silently lost - the durability
 * that usually justifies a broker, without the broker.
 *
 * What this does not give us, honestly: work does not survive the process
 * (only its record does), there is no fan-out across replicas, and two
 * instances pointed at the same file would contend on SQLite writes. The swap
 * to BullMQ is a change to this file alone, because the pipeline knows nothing
 * about how it is scheduled.
 */
export class IngestionQueue extends EventEmitter {
  private active = 0;
  private draining = false;
  private stopped = false;

  constructor(
    private readonly jobs: JobRepository,
    private readonly items: ItemRepository,
    private readonly pipeline: IngestionPipeline,
    private readonly concurrency = config.INGEST_CONCURRENCY,
  ) {
    super();
  }

  /** Recovers jobs that were mid-flight when the process last died. */
  recover(): number {
    const requeued = this.jobs.requeueStale();
    if (requeued > 0) log.warn({ requeued }, 'requeued jobs left running by a previous process');
    if (requeued > 0) this.schedule();
    return requeued;
  }

  enqueue(itemId: string, requestId?: string): string {
    const job = this.jobs.enqueue(itemId);
    log.info({ jobId: job.id, itemId, requestId }, 'ingest job queued');
    this.schedule();
    return job.id;
  }

  pendingCount(): number {
    return this.jobs.pendingCount();
  }

  /** Lets tests await the queue instead of sleeping on a timer. */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.jobs.pendingCount() > 0 || this.active > 0) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the ingestion queue to drain');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /** Kicks the loop on the next tick so enqueue() stays synchronous and cheap. */
  private schedule(): void {
    if (this.draining || this.stopped) return;
    this.draining = true;
    setImmediate(() => {
      this.draining = false;
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    while (!this.stopped && this.active < this.concurrency) {
      const job = this.jobs.claimNext();
      if (!job) return;

      this.active += 1;
      void this.process(job.id, job.itemId)
        .finally(() => {
          this.active -= 1;
          this.schedule();
        });
    }
  }

  private async process(jobId: string, itemId: string): Promise<void> {
    // Reuse the job id as the correlation id so every log line emitted by the
    // pipeline can be traced back to the job that produced it.
    await requestContext.run({ requestId: `job:${jobId}` }, async () => {
      try {
        const result = await this.pipeline.run(itemId);
        this.jobs.complete(jobId);
        this.emit('completed', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // The error itself knows whether another attempt could help. A bad URL
        // or an exhausted daily quota is permanent, and retrying it three times
        // only delays the message the user needs to see - or, on a metered free
        // tier, spends three more requests to learn the same thing.
        const permanent = error instanceof AppError && !error.retryable;
        const { willRetry } = this.jobs.fail(jobId, message, config.MAX_JOB_ATTEMPTS, { permanent });

        if (willRetry) {
          log.warn({ jobId, itemId, err: message }, 'ingest job failed, will retry');
        } else {
          this.items.markFailed(itemId, message);
          log.error({ jobId, itemId, err: message }, 'ingest job failed permanently');
          this.emit('failed', { itemId, error: message });
        }
      }
    });
  }
}
