import { vi } from 'vitest';
import type { HealthResponse, Item, ItemsResponse, QueryResponse } from '../src/api/types';

let sequence = 0;

export function makeItem(overrides: Partial<Item> = {}): Item {
  sequence += 1;
  const createdAt = new Date(Date.now() - sequence * 1000).toISOString();

  return {
    id: `item-${sequence}`,
    sourceType: 'note',
    title: `Item ${sequence}`,
    url: null,
    content: 'content',
    status: 'ready',
    error: null,
    chunkCount: 1,
    charCount: 7,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export function makeQueryResponse(overrides: Partial<QueryResponse> = {}): QueryResponse {
  return {
    question: 'where are vectors stored?',
    answer: 'They live in SQLite [1].',
    citations: [
      {
        marker: 1,
        itemId: 'item-1',
        chunkId: 'chunk-1',
        title: 'Vector store choice',
        url: 'https://example.com/vectors',
        sourceType: 'url',
        score: 0.82,
        snippet: 'Embeddings are stored as float32 blobs.',
      },
    ],
    sources: [
      {
        chunkId: 'chunk-1',
        itemId: 'item-1',
        position: 0,
        score: 0.82,
        title: 'Vector store choice',
        url: 'https://example.com/vectors',
        sourceType: 'url',
        content: 'Embeddings are stored as float32 blobs and scanned linearly.',
      },
    ],
    meta: {
      generator: 'openai',
      model: 'gpt-4o-mini',
      retrievedChunks: 1,
      scannedChunks: 12,
      topK: 6,
      retrievalMs: 3,
      answerMs: 420,
    },
    ...overrides,
  };
}

export const makeHealth = (overrides: Partial<HealthResponse> = {}): HealthResponse => ({
  status: 'ok',
  uptimeSeconds: 10,
  environment: 'test',
  providers: {
    embeddings: { id: 'openai', model: 'text-embedding-3-small', remote: true },
    chat: { id: 'openai', model: 'gpt-4o-mini', remote: true },
  },
  index: { items: { pending: 0, processing: 0, ready: 1, failed: 0 }, chunks: 3, pendingJobs: 0, embeddingDimensions: 1536 },
  retrieval: { topK: 6, chunkSizeChars: 1100 },
  ...overrides,
});

interface RouteHandler {
  (url: string, init?: RequestInit): unknown | Promise<unknown>;
}

/**
 * Stubs global fetch with a tiny router keyed on "METHOD /path".
 *
 * Deliberately routes on the real URL the client builds rather than mocking the
 * api module: that keeps query-string construction, status handling and error
 * parsing inside the code under test instead of inside the mock.
 */
export function stubFetch(routes: Record<string, RouteHandler>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    const path = url.split('?')[0]!;
    const handler = routes[`${method} ${path}`] ?? routes[`${method} *`];

    if (!handler) {
      return new Response(
        JSON.stringify({ error: { code: 'route_not_found', message: `no stub for ${method} ${url}`, requestId: 'test' } }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }

    const result = await handler(url, init);
    if (result instanceof Response) return result;

    return new Response(JSON.stringify(result ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export const errorResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const itemsResponse = (items: Item[], nextCursor: string | null = null): ItemsResponse => ({
  items,
  nextCursor,
  count: items.length,
});
