import { describe, expect, it } from 'vitest';
import { chunkText } from '../src/ingestion/chunker.js';

const options = { maxChars: 200, overlapChars: 40 };

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('', options)).toEqual([]);
    expect(chunkText('   \n\n  \t ', options)).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = chunkText('A short note about vector databases.', options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('A short note about vector databases.');
    expect(chunks[0]!.position).toBe(0);
  });

  it('never emits a chunk larger than maxChars', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with a reasonable amount of filler text in it.`).join(
      '\n\n',
    );
    const chunks = chunkText(text, options);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(options.maxChars);
  });

  it('packs multiple small paragraphs together instead of one chunk each', () => {
    const text = ['One.', 'Two.', 'Three.', 'Four.'].join('\n\n');
    expect(chunkText(text, options)).toHaveLength(1);
  });

  it('carries overlap from one chunk into the next', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} carries some distinctive words.`).join(' ');
    const chunks = chunkText(text, options);

    expect(chunks.length).toBeGreaterThan(1);
    const firstTail = chunks[0]!.content.slice(-20);
    // Some part of the first chunk's tail must reappear at the head of the second.
    expect(chunks[1]!.content.slice(0, options.overlapChars + 20)).toContain(firstTail.split(' ').at(-1)!);
  });

  it('splits a single oversized paragraph on sentence boundaries where it can', () => {
    const sentence = 'This sentence is about sixty characters long, give or take a few. ';
    const chunks = chunkText(sentence.repeat(10), options);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(options.maxChars);
  });

  it('hard-cuts text that has no sentence or paragraph structure', () => {
    const chunks = chunkText('x'.repeat(1000), options);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(options.maxChars);
  });

  it('numbers chunks contiguously from zero', () => {
    const chunks = chunkText('word '.repeat(400), options);
    expect(chunks.map((chunk) => chunk.position)).toEqual(chunks.map((_, index) => index));
  });

  it('rejects an overlap that is not smaller than the chunk size', () => {
    expect(() => chunkText('anything', { maxChars: 100, overlapChars: 100 })).toThrow(/smaller than/);
  });
});
