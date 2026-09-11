import { Router } from 'express';
import type { KnowledgeService } from '../../services/knowledgeService.js';
import { ingestRequestSchema, itemIdParamSchema, listItemsQuerySchema } from '../schemas.js';

/**
 * POST /api/ingest   -> 202, queues a note or URL for indexing
 * GET  /api/items    -> 200, paginated list, newest first
 * GET  /api/items/:id        -> 200 | 404
 * GET  /api/items/:id/chunks -> 200 | 404, what the retriever actually sees
 * DELETE /api/items/:id      -> 204 | 404
 *
 * Handlers parse, delegate and serialise. No business logic lives here.
 * Express 5 forwards rejected promises to the error middleware, so there is no
 * try/catch boilerplate.
 */
export function createItemsRouter(service: KnowledgeService): Router {
  const router = Router();

  router.post('/ingest', (req, res) => {
    const input = ingestRequestSchema.parse(req.body);
    const result = service.ingest(input, res.locals.requestId as string);

    // 200 for a URL we already hold, 202 for work that was actually queued -
    // the client can tell "accepted for processing" from "already have this".
    res.status(result.deduplicated ? 200 : 202).json({
      item: result.item,
      jobId: result.jobId || null,
      deduplicated: result.deduplicated,
    });
  });

  router.get('/items', (req, res) => {
    const { limit, status, cursor } = listItemsQuerySchema.parse(req.query);
    const { items, nextCursor } = service.listItems({ limit, status, cursor });
    res.json({ items, nextCursor, count: items.length });
  });

  router.get('/items/:id', (req, res) => {
    const { id } = itemIdParamSchema.parse(req.params);
    res.json({ item: service.getItem(id) });
  });

  router.get('/items/:id/chunks', (req, res) => {
    const { id } = itemIdParamSchema.parse(req.params);
    const chunks = service.getItemChunks(id);
    res.json({ itemId: id, chunks, count: chunks.length });
  });

  router.delete('/items/:id', (req, res) => {
    const { id } = itemIdParamSchema.parse(req.params);
    service.deleteItem(id);
    res.status(204).end();
  });

  return router;
}
