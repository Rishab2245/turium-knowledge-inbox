import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Present only in the production image, where the frontend is built into the
// server's public directory and served from the same origin.
const staticDir = path.resolve(here, '../public');
const hasStatic = fs.existsSync(path.join(staticDir, 'index.html'));

const { app, db, queue, providers } = buildApp(hasStatic ? { staticDir } : {});

queue.recover();

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      environment: config.NODE_ENV,
      embeddings: providers.embeddings.model,
      chat: providers.chat?.model ?? 'extractive-fallback',
      servingFrontend: hasStatic,
    },
    'knowledge inbox api listening',
  );
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then close SQLite so WAL is checkpointed cleanly. A hard exit timer guards
 * against a hung connection keeping the process alive forever.
 */
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  queue.stop();
  server.close((error) => {
    if (error) logger.error({ err: error.message }, 'error while closing the http server');
    try {
      db.close();
    } catch (dbError) {
      logger.error({ err: (dbError as Error).message }, 'error while closing the database');
    }
    clearTimeout(forceExit);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// An unhandled rejection means a code path lost its error. Log it loudly rather
// than letting the process die silently on a future Node version.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error.message, stack: error.stack }, 'uncaught exception, shutting down');
  shutdown('uncaughtException');
});
