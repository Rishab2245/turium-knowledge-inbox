import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { loggerFor } from '../lib/logger.js';
import { migrate } from './schema.js';

const log = loggerFor('db');

export type Db = Database.Database;

export function openDatabase(databasePath = config.DATABASE_PATH): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath);

  // WAL lets reads proceed while a write transaction is open, which matters
  // because ingestion writes in the background while the UI is polling.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const { applied } = migrate(db);
  if (applied.length > 0) log.info({ applied, databasePath }, 'applied database migrations');

  return db;
}
