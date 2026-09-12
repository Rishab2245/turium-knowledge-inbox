import { Router } from 'express';
import { config } from '../../config/index.js';
import type { Providers } from '../../providers/index.js';
import type { KnowledgeService } from '../../services/knowledgeService.js';

/**
 * GET /api/health -> liveness plus enough detail to explain surprising
 * behaviour without reading the server logs: which providers are live, how
 * much is indexed, how many ingest jobs are still in flight.
 *
 * The frontend reads `providers.chat.remote` to warn, up front, that answers
 * will be extractive rather than generated.
 */
export function createHealthRouter(service: KnowledgeService, providers: Providers): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      environment: config.NODE_ENV,
      providers: {
        // The vendor actually being talked to, which "openai" alone does not
        // say now that Gemini is reached through the same client.
        name: config.provider.name,
        embeddings: {
          id: providers.embeddings.id,
          model: providers.embeddings.model,
          remote: providers.embeddings.isRemote,
          dimensions: providers.embeddings.dimensions || null,
        },
        chat: providers.chat
          ? { id: providers.chat.id, model: providers.chat.model, remote: true }
          : { id: 'extractive-fallback', model: 'none', remote: false },
      },
      index: service.stats(),
      retrieval: { topK: config.RETRIEVAL_TOP_K, chunkSizeChars: config.CHUNK_SIZE_CHARS },
    });
  });

  return router;
}
