import type { Answer, Citation, ScoredChunk } from '../domain/types.js';
import { loggerFor } from '../lib/logger.js';
import type { ChatProvider } from '../providers/index.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';

const log = loggerFor('rag.answerer');

const SNIPPET_CHARS = 320;

export interface Answerer {
  answer(question: string, chunks: ScoredChunk[]): Promise<Answer>;
}

/** Generative path: retrieved chunks go to a chat model with a citation contract. */
export class LlmAnswerer implements Answerer {
  constructor(private readonly chat: ChatProvider) {}

  async answer(question: string, chunks: ScoredChunk[]): Promise<Answer> {
    const startedAt = Date.now();
    const completion = await this.chat.complete([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(question, chunks) },
    ]);

    const { text, usedMarkers } = reconcileCitations(completion.text, chunks.length);

    return {
      answer: text,
      // Only the sources the model actually cited are returned, so the UI does
      // not display four "sources" for a one-line answer that used one.
      citations: usedMarkers.map((marker) => toCitation(marker, chunks[marker - 1]!)),
      generator: this.chat.id,
      model: completion.model,
      usedChunks: chunks.length,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Fallback used when no chat model is configured.
 *
 * It does not pretend to generate prose: it returns the highest-scoring
 * retrieved passages, trimmed to the sentences that overlap the question, each
 * with its citation. Retrieval quality is still visible and reviewable, which
 * is the point - it keeps the app honest instead of silently returning nothing.
 */
export class ExtractiveAnswerer implements Answerer {
  readonly id = 'extractive-fallback';

  async answer(question: string, chunks: ScoredChunk[]): Promise<Answer> {
    const startedAt = Date.now();
    const top = chunks.slice(0, 3);

    const body = top
      .map((chunk, index) => `[${index + 1}] ${bestSentences(chunk.content, question)}`)
      .join('\n\n');

    const text =
      'No chat model is configured, so this is an extract of the most relevant saved passages ' +
      'rather than a generated answer. Set GEMINI_API_KEY or OPENAI_API_KEY to get synthesised answers.\n\n' +
      body;

    log.debug({ question, sources: top.length }, 'answered extractively');

    return {
      answer: text,
      citations: top.map((chunk, index) => toCitation(index + 1, chunk)),
      generator: this.id,
      model: 'none',
      usedChunks: chunks.length,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Response for a question with no retrievable context. */
export function emptyAnswer(reason: string): Answer {
  return { answer: reason, citations: [], generator: 'none', model: 'none', usedChunks: 0, latencyMs: 0 };
}

function toCitation(marker: number, chunk: ScoredChunk): Citation {
  return {
    marker,
    itemId: chunk.itemId,
    chunkId: chunk.id,
    title: chunk.item.title,
    url: chunk.item.url,
    sourceType: chunk.item.sourceType,
    score: chunk.score,
    snippet: truncate(chunk.content, SNIPPET_CHARS),
  };
}

/**
 * Models occasionally cite a source number that was never supplied. Dropping
 * those markers is better than returning an answer whose brackets do not line
 * up with the citation list the UI renders.
 */
export function reconcileCitations(raw: string, sourceCount: number): { text: string; usedMarkers: number[] } {
  const used = new Set<number>();

  const text = raw.replace(/\[(\d+)\]/g, (match, digits: string) => {
    const marker = Number(digits);
    if (marker >= 1 && marker <= sourceCount) {
      used.add(marker);
      return match;
    }
    log.warn({ marker, sourceCount }, 'model cited a source that was not provided; dropping the marker');
    return '';
  });

  return { text: text.replace(/ {2,}/g, ' ').trim(), usedMarkers: [...used].sort((a, b) => a - b) };
}

/** Picks the sentences with the most question-term overlap, preserving order. */
function bestSentences(content: string, question: string): string {
  const terms = new Set((question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));
  const sentences = content.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length <= 2) return truncate(content, SNIPPET_CHARS);

  const ranked = sentences
    .map((sentence, index) => {
      const words = sentence.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
      const overlap = words.filter((word) => terms.has(word)).length;
      return { sentence, index, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index);

  return truncate(ranked.map((entry) => entry.sentence).join(' '), SNIPPET_CHARS);
}

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`;
