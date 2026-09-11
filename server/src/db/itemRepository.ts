import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';
import type { Item, ItemStatus, SourceType } from '../domain/types.js';

interface ItemRow {
  id: string;
  source_type: SourceType;
  title: string;
  url: string | null;
  content: string;
  status: ItemStatus;
  error: string | null;
  chunk_count: number;
  char_count: number;
  created_at: string;
  updated_at: string;
}

const toItem = (row: ItemRow): Item => ({
  id: row.id,
  sourceType: row.source_type,
  title: row.title,
  url: row.url,
  content: row.content,
  status: row.status,
  error: row.error,
  chunkCount: row.chunk_count,
  charCount: row.char_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface CreateItemInput {
  sourceType: SourceType;
  title: string;
  url: string | null;
  content: string;
}

export class ItemRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateItemInput): Item {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO items (id, source_type, title, url, content, status, chunk_count, char_count, created_at, updated_at)
         VALUES (@id, @sourceType, @title, @url, @content, 'pending', 0, @charCount, @now, @now)`,
      )
      .run({
        id,
        sourceType: input.sourceType,
        title: input.title,
        url: input.url,
        content: input.content,
        charCount: input.content.length,
        now,
      });
    return this.getById(id)!;
  }

  getById(id: string): Item | null {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  /** Keyset pagination on (created_at, id) — stable while new items arrive. */
  list(options: { limit: number; status?: ItemStatus; cursor?: string }): {
    items: Item[];
    nextCursor: string | null;
  } {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: options.limit + 1 };

    if (options.status) {
      where.push('status = @status');
      params.status = options.status;
    }
    if (options.cursor) {
      const [createdAt, id] = decodeCursor(options.cursor);
      where.push('(created_at < @cursorCreatedAt OR (created_at = @cursorCreatedAt AND id < @cursorId))');
      params.cursorCreatedAt = createdAt;
      params.cursorId = id;
    }

    const sql = `SELECT * FROM items
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC, id DESC
                 LIMIT @limit`;

    const rows = this.db.prepare(sql).all(params) as ItemRow[];
    const page = rows.slice(0, options.limit).map(toItem);
    const hasMore = rows.length > options.limit;
    const last = page.at(-1);

    return {
      items: page,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  countByStatus(): Record<ItemStatus, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM items GROUP BY status')
      .all() as Array<{ status: ItemStatus; n: number }>;
    const base: Record<ItemStatus, number> = { pending: 0, processing: 0, ready: 0, failed: 0 };
    for (const row of rows) base[row.status] = row.n;
    return base;
  }

  findByUrl(url: string): Item | null {
    const row = this.db
      .prepare("SELECT * FROM items WHERE source_type = 'url' AND url = ? ORDER BY created_at DESC LIMIT 1")
      .get(url) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  markProcessing(id: string): void {
    this.db
      .prepare("UPDATE items SET status = 'processing', error = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  markReady(id: string, patch: { title?: string; content: string; chunkCount: number }): void {
    this.db
      .prepare(
        `UPDATE items
            SET status = 'ready',
                error = NULL,
                title = COALESCE(@title, title),
                content = @content,
                char_count = @charCount,
                chunk_count = @chunkCount,
                updated_at = @now
          WHERE id = @id`,
      )
      .run({
        id,
        title: patch.title ?? null,
        content: patch.content,
        charCount: patch.content.length,
        chunkCount: patch.chunkCount,
        now: new Date().toISOString(),
      });
  }

  markFailed(id: string, error: string): void {
    this.db
      .prepare("UPDATE items SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(error.slice(0, 500), new Date().toISOString(), id);
  }

  delete(id: string): boolean {
    // chunks and jobs cascade via foreign keys.
    return this.db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
  }
}

const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id) throw new Error('malformed cursor');
  return [createdAt, id];
}
