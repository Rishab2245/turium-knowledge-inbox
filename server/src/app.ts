import path from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { ChunkRepository } from './db/chunkRepository.js';
import { openDatabase, type Db } from './db/index.js';
import { ItemRepository } from './db/itemRepository.js';
import { JobRepository } from './db/jobRepository.js';
import { errorHandler, notFoundHandler } from './http/middleware/errorHandler.js';
import { requestContextMiddleware } from './http/middleware/requestContext.js';
import { createHealthRouter } from './http/routes/health.js';
import { createItemsRouter } from './http/routes/items.js';
import { createQueryRouter } from './http/routes/query.js';
import { IngestionPipeline } from './ingestion/pipeline.js';
import { IngestionQueue } from './ingestion/queue.js';
import { createProviders, type Providers } from './providers/index.js';
import { ExtractiveAnswerer, LlmAnswerer, type Answerer } from './rag/answerer.js';
import { Retriever } from './rag/retriever.js';
import { KnowledgeService } from './services/knowledgeService.js';

export interface AppContext {
  app: Express;
  db: Db;
  queue: IngestionQueue;
  service: KnowledgeService;
  providers: Providers;
}

export interface BuildOptions {
  databasePath?: string;
  providers?: Providers;
  /** Serve the built frontend from the same origin (used by the Docker image). */
  staticDir?: string;
}

/**
 * Composition root. Everything is constructed here and injected downward, so no
 * module reaches for a global singleton and tests can build a fully isolated
 * app over an in-memory database with stub providers.
 */
export function buildApp(options: BuildOptions = {}): AppContext {
  const db = openDatabase(options.databasePath ?? config.DATABASE_PATH);
  const providers = options.providers ?? createProviders();

  const items = new ItemRepository(db);
  const chunks = new ChunkRepository(db);
  const jobs = new JobRepository(db);

  const pipeline = new IngestionPipeline(items, chunks, providers.embeddings);
  const queue = new IngestionQueue(jobs, items, pipeline);
  const retriever = new Retriever(chunks, providers.embeddings);
  const answerer: Answerer = providers.chat ? new LlmAnswerer(providers.chat) : new ExtractiveAnswerer();
  const service = new KnowledgeService(items, chunks, jobs, queue, retriever, answerer);

  const app = express();
  app.disable('x-powered-by');
  // Trust the proxy so request logs show the real client IP behind Render/Fly.
  app.set('trust proxy', 1);

  app.use(requestContextMiddleware);
  app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(','), maxAge: 86_400 }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createHealthRouter(service, providers));
  app.use('/api', createItemsRouter(service));
  app.use('/api', createQueryRouter(service));

  if (options.staticDir) {
    app.use(express.static(options.staticDir, { maxAge: '1h', index: false }));
    // SPA fallback, but never for /api - an unknown API route must 404 as JSON
    // rather than quietly returning the HTML shell.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, db, queue, service, providers };
}
