import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';
import type { Chunk, ScoredChunk, SourceType } from '../domain/types.js';

export interface ChunkWithEmbedding {
  id: string;
  itemId: string;
  position: number;
  content: string;
  charCount: number;
  embedding: Float32Array;
  itemTitle: string;
  itemUrl: string | null;
  itemSourceType: SourceType;
  itemCreatedAt: string;
}

interface JoinedRow {
  id: string;
  item_id: string;
  position: number;
  content: string;
  char_count: number;
  embedding: Buffer;
  title: string;
  url: string | null;
  source_type: SourceType;
  created_at: string;
}

/**
 * Float32Array <-> BLOB. The copy on decode matters: node hands back a Buffer
 * that is a view into a shared pool, so constructing a Float32Array directly
 * over it can be misaligned or pick up neighbouring bytes.
 */
export const encodeEmbedding = (vector: Float32Array): Buffer =>
  Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);

export const decodeEmbedding = (blob: Buffer): Float32Array => {
  const copy = Uint8Array.prototype.slice.call(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
};

export class ChunkRepository {
  constructor(private readonly db: Db) {}

  /**
   * Replaces every chunk for an item in one transaction, so a re-index never
   * leaves the item half-embedded.
   */
  replaceForItem(
    itemId: string,
    chunks: Array<{ position: number; content: string; embedding: Float32Array }>,
    model: string,
  ): number {
    const now = new Date().toISOString();
    const del = this.db.prepare('DELETE FROM chunks WHERE item_id = ?');
    const ins = this.db.prepare(
      `INSERT INTO chunks (id, item_id, position, content, char_count, embedding, dim, model, created_at)
       VALUES (@id, @itemId, @position, @content, @charCount, @embedding, @dim, @model, @now)`,
    );

    return this.db.transaction(() => {
      del.run(itemId);
      for (const chunk of chunks) {
        ins.run({
          id: randomUUID(),
          itemId,
          position: chunk.position,
          content: chunk.content,
          charCount: chunk.content.length,
          embedding: encodeEmbedding(chunk.embedding),
          dim: chunk.embedding.length,
          model,
          now,
        });
      }
      return chunks.length;
    })();
  }

  /**
   * Loads every embedded chunk for a brute-force similarity scan.
   *
   * This is the deliberate scaling limit of the design: O(N) rows and
   * O(N * dim) float operations per query. It is fast and exact for the
   * low tens of thousands of chunks a single-user inbox holds. The README
   * documents the migration path to an approximate-nearest-neighbour index.
   */
  loadAllForSearch(): ChunkWithEmbedding[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.item_id, c.position, c.content, c.char_count, c.embedding,
                i.title, i.url, i.source_type, i.created_at
           FROM chunks c
           JOIN items i ON i.id = c.item_id
          WHERE i.status = 'ready'`,
      )
      .all() as JoinedRow[];

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      position: row.position,
      content: row.content,
      charCount: row.char_count,
      embedding: decodeEmbedding(row.embedding),
      itemTitle: row.title,
      itemUrl: row.url,
      itemSourceType: row.source_type,
      itemCreatedAt: row.created_at,
    }));
  }

  listForItem(itemId: string): Chunk[] {
    const rows = this.db
      .prepare(
        'SELECT id, item_id, position, content, char_count FROM chunks WHERE item_id = ? ORDER BY position',
      )
      .all(itemId) as Array<{
      id: string;
      item_id: string;
      position: number;
      content: string;
      char_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      position: row.position,
      content: row.content,
      charCount: row.char_count,
    }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
  }

  /**
   * Dimension of the stored vectors, or null when the index is empty. Used to
   * detect an embedding-model change that would silently corrupt similarity
   * scores by comparing vectors from two different spaces.
   */
  storedDimension(): number | null {
    const row = this.db.prepare('SELECT dim FROM chunks LIMIT 1').get() as { dim: number } | undefined;
    return row?.dim ?? null;
  }

  toScored(chunk: ChunkWithEmbedding, score: number): ScoredChunk {
    return {
      id: chunk.id,
      itemId: chunk.itemId,
      position: chunk.position,
      content: chunk.content,
      charCount: chunk.charCount,
      score,
      item: {
        id: chunk.itemId,
        title: chunk.itemTitle,
        url: chunk.itemUrl,
        sourceType: chunk.itemSourceType,
        createdAt: chunk.itemCreatedAt,
      },
    };
  }
}
