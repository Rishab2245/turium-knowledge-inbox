import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIEmbeddingProvider } from '../src/providers/embeddings/openaiEmbeddings.js';
import { UpstreamError } from '../src/domain/errors.js';

/**
 * Stubs the shape of the SDK response, since the point of these tests is how we
 * handle what a provider sends back, not the SDK itself.
 */
function stubClient(
  respond: (input: string[]) => Array<{ index?: number; embedding: number[] }>,
): { client: OpenAI; calls: () => Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    embeddings: {
      async create(params: { input: string[] }) {
        calls.push(params as Record<string, unknown>);
        return { data: respond(params.input) };
      },
    },
  } as unknown as OpenAI;

  return { client, calls: () => calls };
}

const vectorFor = (seed: number, dim = 4) => Array.from({ length: dim }, (_, i) => (i === seed % dim ? 1 : 0));

describe('OpenAIEmbeddingProvider ordering', () => {
  it('preserves input order when the provider returns indexes out of order', async () => {
    const provider = new OpenAIEmbeddingProvider(
      stubClient(() => [
        { index: 2, embedding: vectorFor(2) },
        { index: 0, embedding: vectorFor(0) },
        { index: 1, embedding: vectorFor(1) },
      ]).client,
      'test-model',
    );

    const vectors = await provider.embed(['a', 'b', 'c']);

    expect(Array.from(vectors[0]!)).toEqual(vectorFor(0));
    expect(Array.from(vectors[1]!)).toEqual(vectorFor(1));
    expect(Array.from(vectors[2]!)).toEqual(vectorFor(2));
  });

  it('treats an omitted index as position zero, the way Gemini sends it', async () => {
    // Gemini's OpenAI-compatible endpoint omits `index` when it is 0, because
    // protobuf drops default values. A naive numeric comparator yields NaN here.
    const provider = new OpenAIEmbeddingProvider(
      stubClient(() => [
        { embedding: vectorFor(0) }, // index omitted: means 0
        { index: 1, embedding: vectorFor(1) },
        { index: 2, embedding: vectorFor(2) },
      ]).client,
      'gemini-embedding-001',
    );

    const vectors = await provider.embed(['a', 'b', 'c']);

    expect(Array.from(vectors[0]!)).toEqual(vectorFor(0));
    expect(Array.from(vectors[1]!)).toEqual(vectorFor(1));
    expect(Array.from(vectors[2]!)).toEqual(vectorFor(2));
  });

  it('still sorts correctly when an omitted index must move to the front', async () => {
    const provider = new OpenAIEmbeddingProvider(
      stubClient(() => [
        { index: 1, embedding: vectorFor(1) },
        { embedding: vectorFor(0) }, // omitted index 0, arriving second
      ]).client,
      'gemini-embedding-001',
    );

    const vectors = await provider.embed(['a', 'b']);

    expect(Array.from(vectors[0]!)).toEqual(vectorFor(0));
    expect(Array.from(vectors[1]!)).toEqual(vectorFor(1));
  });
});

describe('OpenAIEmbeddingProvider dimensions', () => {
  it('learns the real dimension from the response for an unknown model', async () => {
    const provider = new OpenAIEmbeddingProvider(
      stubClient((input) => input.map((_, index) => ({ index, embedding: vectorFor(index, 8) }))).client,
      'some-third-party-model',
    );

    expect(provider.dimensions).toBe(0); // unknown before the first call
    await provider.embed(['a']);
    expect(provider.dimensions).toBe(8);
  });

  it('knows gemini-embedding-001 up front', () => {
    expect(new OpenAIEmbeddingProvider(stubClient(() => []).client, 'gemini-embedding-001').dimensions).toBe(3072);
  });

  it('only sends the dimensions parameter when one is configured', async () => {
    const withoutStub = stubClient((input) => input.map((_, index) => ({ index, embedding: vectorFor(index) })));
    await new OpenAIEmbeddingProvider(withoutStub.client, 'gemini-embedding-001').embed(['a']);
    expect(withoutStub.calls()[0]).not.toHaveProperty('dimensions');

    const withStub = stubClient((input) => input.map((_, index) => ({ index, embedding: vectorFor(index) })));
    await new OpenAIEmbeddingProvider(withStub.client, 'gemini-embedding-001', 768).embed(['a']);
    expect(withStub.calls()[0]).toMatchObject({ dimensions: 768 });
  });
});

describe('OpenAIEmbeddingProvider failure handling', () => {
  it('rejects a batch that comes back short rather than misaligning vectors', async () => {
    const provider = new OpenAIEmbeddingProvider(
      stubClient(() => [{ index: 0, embedding: vectorFor(0) }]).client,
      'test-model',
    );

    await expect(provider.embed(['a', 'b', 'c'])).rejects.toThrow(UpstreamError);
  });

  it('normalises vectors that arrive un-normalised', async () => {
    const provider = new OpenAIEmbeddingProvider(
      stubClient(() => [{ index: 0, embedding: [3, 4, 0, 0] }]).client,
      'test-model',
    );

    const [vector] = await provider.embed(['a']);
    let magnitude = 0;
    for (const value of vector!) magnitude += value * value;

    expect(Math.sqrt(magnitude)).toBeCloseTo(1, 5);
    expect(vector![0]).toBeCloseTo(0.6, 5);
  });

  it('wraps a provider error as an upstream failure', async () => {
    const client = {
      embeddings: {
        async create() {
          throw Object.assign(new Error('invalid api key'), { status: 401 });
        },
      },
    } as unknown as OpenAI;

    await expect(new OpenAIEmbeddingProvider(client, 'test-model').embed(['a'])).rejects.toThrow(/invalid api key/);
  });
});
