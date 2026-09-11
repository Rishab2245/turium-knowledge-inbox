import { describe, expect, it } from 'vitest';
import { ExtractiveAnswerer, LlmAnswerer, reconcileCitations } from '../src/rag/answerer.js';
import type { ScoredChunk } from '../src/domain/types.js';
import type { ChatProvider } from '../src/providers/llm/types.js';

const chunk = (id: string, content: string, score: number): ScoredChunk => ({
  id,
  itemId: `item-${id}`,
  position: 0,
  content,
  charCount: content.length,
  score,
  item: {
    id: `item-${id}`,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    sourceType: 'url',
    createdAt: new Date().toISOString(),
  },
});

describe('reconcileCitations', () => {
  it('keeps markers that refer to a supplied source', () => {
    const { text, usedMarkers } = reconcileCitations('SQLite is embedded [1] and fast [2].', 2);
    expect(text).toBe('SQLite is embedded [1] and fast [2].');
    expect(usedMarkers).toEqual([1, 2]);
  });

  it('drops a hallucinated marker instead of returning a broken reference', () => {
    const { text, usedMarkers } = reconcileCitations('Claim one [1]. Claim two [7].', 2);
    expect(text).not.toContain('[7]');
    expect(usedMarkers).toEqual([1]);
  });

  it('deduplicates repeated markers and returns them in order', () => {
    const { usedMarkers } = reconcileCitations('[2] then [1] then [2] again.', 3);
    expect(usedMarkers).toEqual([1, 2]);
  });

  it('reports no citations when the model cited nothing', () => {
    expect(reconcileCitations('I could not find that in the sources.', 3).usedMarkers).toEqual([]);
  });
});

describe('LlmAnswerer', () => {
  const sources = [chunk('a', 'SQLite stores the vectors.', 0.8), chunk('b', 'Chunks overlap by 180 characters.', 0.6)];

  it('returns only the sources the model actually cited', async () => {
    const chat: ChatProvider = {
      id: 'stub',
      model: 'stub-model',
      isRemote: true,
      async complete() {
        return { text: 'The vectors live in SQLite [1].', model: 'stub-model' };
      },
    };

    const answer = await new LlmAnswerer(chat).answer('where are vectors stored?', sources);

    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]).toMatchObject({ marker: 1, chunkId: 'a', url: 'https://example.com/a' });
    expect(answer.usedChunks).toBe(2);
    expect(answer.generator).toBe('stub');
  });

  it('passes the question and every source into the prompt', async () => {
    let seen = '';
    const chat: ChatProvider = {
      id: 'stub',
      model: 'stub-model',
      isRemote: true,
      async complete(messages) {
        seen = messages.map((message) => message.content).join('\n');
        return { text: 'ok [1]', model: 'stub-model' };
      },
    };

    await new LlmAnswerer(chat).answer('how big is the overlap?', sources);

    expect(seen).toContain('how big is the overlap?');
    expect(seen).toContain('SQLite stores the vectors.');
    expect(seen).toContain('Chunks overlap by 180 characters.');
    expect(seen).toContain('[2]');
  });
});

describe('ExtractiveAnswerer', () => {
  it('cites the top passages and says plainly that it is not generating', async () => {
    const answer = await new ExtractiveAnswerer().answer('what is stored?', [
      chunk('a', 'The vector store keeps embeddings. Unrelated filler sentence here.', 0.8),
      chunk('b', 'Second source about storage.', 0.5),
    ]);

    expect(answer.generator).toBe('extractive-fallback');
    expect(answer.answer).toContain('OPENAI_API_KEY');
    expect(answer.citations).toHaveLength(2);
    expect(answer.citations[0]!.marker).toBe(1);
  });
});
