import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface IngestJob {
  id: string;
  itemId: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
}

interface JobRow {
  id: string;
  item_id: string;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
}

const toJob = (row: JobRow): IngestJob => ({
  id: row.id,
  itemId: row.item_id,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
});

export class JobRepository {
  constructor(private readonly db: Db) {}

  enqueue(itemId: string): IngestJob {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ingest_jobs (id, item_id, status, attempts, created_at, updated_at)
         VALUES (?, ?, 'queued', 0, ?, ?)`,
      )
      .run(id, itemId, now, now);
    return { id, itemId, status: 'queued', attempts: 0, lastError: null };
  }

  /**
   * Atomically claims the oldest queued job. The conditional UPDATE is the
   * lock: if two workers race for the same row, one of them sees zero changed
   * rows and moves on to the next job instead of double-processing.
   */
  claimNext(): IngestJob | null {
    return this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM ingest_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1")
        .get() as JobRow | undefined;
      if (!row) return null;

      const result = this.db
        .prepare(
          `UPDATE ingest_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
            WHERE id = ? AND status = 'queued'`,
        )
        .run(new Date().toISOString(), row.id);

      if (result.changes === 0) return null;
      return toJob({ ...row, status: 'running', attempts: row.attempts + 1 });
    })();
  }

  complete(jobId: string): void {
    this.db
      .prepare("UPDATE ingest_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), jobId);
  }

  /**
   * Requeue for another attempt, or give up once the attempt budget is spent.
   * `permanent` short-circuits the budget for errors that retrying cannot fix,
   * such as a malformed URL or a page that returns 404.
   */
  fail(
    jobId: string,
    error: string,
    maxAttempts: number,
    options: { permanent?: boolean } = {},
  ): { willRetry: boolean } {
    const now = new Date().toISOString();
    const row = this.db.prepare('SELECT attempts FROM ingest_jobs WHERE id = ?').get(jobId) as
      | { attempts: number }
      | undefined;
    const willRetry = !options.permanent && (row?.attempts ?? maxAttempts) < maxAttempts;

    this.db
      .prepare('UPDATE ingest_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .run(willRetry ? 'queued' : 'failed', error.slice(0, 500), now, jobId);

    return { willRetry };
  }

  /**
   * Jobs left in `running` by a crash are not lost: they go back on the queue
   * at boot. Safe because the pipeline is idempotent per item.
   */
  requeueStale(): number {
    return this.db
      .prepare("UPDATE ingest_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'")
      .run(new Date().toISOString()).changes;
  }

  pendingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM ingest_jobs WHERE status IN ('queued','running')")
      .get() as { n: number };
    return row.n;
  }
}
