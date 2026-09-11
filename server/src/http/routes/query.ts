import { Router } from 'express';
import type { KnowledgeService } from '../../services/knowledgeService.js';
import { queryRequestSchema } from '../schemas.js';

/**
 * POST /api/query -> 200 with an answer, its citations and the raw retrieved
 * passages.
 *
 * The response deliberately exposes retrieval internals (`sources` with their
 * scores, `retrieval.scannedChunks`) alongside the answer. A RAG system that
 * only returns prose is impossible to debug: when an answer is wrong you need
 * to know whether retrieval missed or the model ignored what it was given.
 *
 * "No relevant context" is a 200 with an empty citation list, not a 404. The
 * query succeeded; the corpus just had nothing to say.
 */
export function createQueryRouter(service: KnowledgeService): Router {
  const router = Router();

  router.post('/query', async (req, res) => {
    const { question, topK, itemIds } = queryRequestSchema.parse(req.body);
    const result = await service.query(question, { topK, itemIds });

    res.json({
      question: result.question,
      answer: result.answer.answer,
      citations: result.answer.citations,
      sources: result.sources.map((source) => ({
        chunkId: source.id,
        itemId: source.itemId,
        position: source.position,
        score: source.score,
        title: source.item.title,
        url: source.item.url,
        sourceType: source.item.sourceType,
        content: source.content,
      })),
      meta: {
        generator: result.answer.generator,
        model: result.answer.model,
        retrievedChunks: result.sources.length,
        scannedChunks: result.retrieval.scannedChunks,
        topK: result.retrieval.topK,
        retrievalMs: result.retrieval.latencyMs,
        answerMs: result.answer.latencyMs,
      },
    });
  });

  return router;
}
