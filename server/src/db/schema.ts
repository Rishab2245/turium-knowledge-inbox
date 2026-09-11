import type Database from 'better-sqlite3';

/**
 * Migrations are a plain ordered list applied inside a transaction and tracked
 * with `PRAGMA user_version`. That is enough for a single-node SQLite app and
 * avoids pulling in a migration framework for three tables.
 */
const MIGRATIONS: Array<{ name: string; up: string }> = [
  {
    name: '001_initial',
    up: `
      CREATE TABLE items (
        id           TEXT PRIMARY KEY,
        source_type  TEXT NOT NULL CHECK (source_type IN ('note', 'url')),
        title        TEXT NOT NULL,
        url          TEXT,
        content      TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL CHECK (status IN ('pending','processing','ready','failed')),
        error        TEXT,
        chunk_count  INTEGER NOT NULL DEFAULT 0,
        char_count   INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_items_created_at ON items (created_at DESC);
      CREATE INDEX idx_items_status ON items (status);

      CREATE TABLE chunks (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        position   INTEGER NOT NULL,
        content    TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        -- Float32 vector stored as a raw little-endian BLOB. Storing it as a
        -- BLOB instead of JSON keeps the row ~4x smaller and lets us map it
        -- straight into a Float32Array with no parsing.
        embedding  BLOB NOT NULL,
        dim        INTEGER NOT NULL,
        model      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (item_id, position)
      );
      CREATE INDEX idx_chunks_item_id ON chunks (item_id);

      -- Job state is persisted rather than held only in memory so that an
      -- interrupted ingest is recoverable on the next boot.
      CREATE TABLE ingest_jobs (
        id          TEXT PRIMARY KEY,
        item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        status      TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_jobs_status ON ingest_jobs (status);
    `,
  },
];

export function migrate(db: Database.Database): { applied: string[] } {
  const applied: string[] = [];
  const current = db.pragma('user_version', { simple: true }) as number;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const migration = MIGRATIONS[version]!;
    db.transaction(() => {
      db.exec(migration.up);
      db.pragma(`user_version = ${version + 1}`);
    })();
    applied.push(migration.name);
  }
  return { applied };
}
