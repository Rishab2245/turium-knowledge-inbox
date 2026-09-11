import type { ScoredChunk } from '../domain/types.js';

export const SYSTEM_PROMPT = [
  'You answer questions using only the numbered sources provided by the user.',
  '',
  'Rules:',
  '1. Use only facts present in the sources. Never add outside knowledge.',
  '2. Cite every claim with the bracketed number of the source it came from, e.g. [2].',
  '   A sentence drawing on two sources cites both, e.g. [1][3].',
  '3. If the sources do not contain the answer, say so plainly and name what is',
  '   missing. Do not guess, and do not pad the answer with related-but-unasked material.',
  '4. Be concise. Prefer three tight sentences over three paragraphs. Use short',
  '   bullets only when the question genuinely has a list for an answer.',
  '5. Never invent a source number that was not given to you.',
].join('\n');

/**
 * Sources are rendered as an explicit numbered block, and the numbering is the
 * contract the model cites against: marker N in the answer maps to
 * `citations[N-1]` in the response. Titles and URLs are included so the model
 * can attribute ("according to the Redis docs") rather than cite blindly.
 */
export function buildUserPrompt(question: string, chunks: ScoredChunk[]): string {
  const sources = chunks
    .map((chunk, index) => {
      const origin = chunk.item.url ? `${chunk.item.title} (${chunk.item.url})` : chunk.item.title;
      return `[${index + 1}] ${origin}\n${chunk.content}`;
    })
    .join('\n\n---\n\n');

  return [
    'SOURCES',
    '=======',
    sources,
    '',
    'QUESTION',
    '========',
    question,
    '',
    'Answer the question using only the sources above, citing them by number.',
  ].join('\n');
}
