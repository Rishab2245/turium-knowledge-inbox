import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppContext } from '../src/app.js';
import { LocalEmbeddingProvider } from '../src/providers/embeddings/localEmbeddings.js';
import type { ChatProvider } from '../src/providers/llm/types.js';

/**
 * End-to-end over the real router, service, queue and SQLite schema, with only
 * the model providers stubbed. An in-memory database keeps each test isolated
 * and makes the suite runnable with no credentials and no network.
 */
const stubChat: ChatProvider = {
  id: 'stub',
  model: 'stub-model',
  isRemote: true,
  async complete(messages) {
    const prompt = messages.at(-1)?.content ?? '';
    // Echo back the first source so assertions can prove the retrieved context
    // actually reached the model.
    const firstSource = prompt.split('[1] ')[1]?.split('\n')[1] ?? '';
    return { text: `Answer grounded in: ${firstSource.slice(0, 60)} [1]`, model: 'stub-model' };
  },
};

let context: AppContext;

beforeEach(() => {
  context = buildApp({
    databasePath: ':memory:',
    providers: { embeddings: new LocalEmbeddingProvider(), chat: stubChat },
  });
});

afterEach(() => {
  context.queue.stop();
  context.db.close();
});

const api = () => request(context.app);

async function ingestNote(content: string, title?: string) {
  const response = await api()
    .post('/api/ingest')
    .send({ type: 'note', content, ...(title ? { title } : {}) })
    .expect(202);
  await context.queue.drain();
  return response.body.item.id as string;
}

describe('POST /api/ingest', () => {
  it('accepts a note, returns 202 with a pending item, and indexes it asynchronously', async () => {
    const response = await api()
      .post('/api/ingest')
      .send({ type: 'note', content: 'Vectors are stored in SQLite as float32 blobs.' })
      .expect(202);

    expect(response.body.item).toMatchObject({ sourceType: 'note', status: 'pending', chunkCount: 0 });
    expect(response.body.jobId).toBeTruthy();
    expect(response.headers['x-request-id']).toBeTruthy();

    await context.queue.drain();

    const after = await api().get(`/api/items/${response.body.item.id}`).expect(200);
    expect(after.body.item.status).toBe('ready');
    expect(after.body.item.chunkCount).toBeGreaterThan(0);
  });

  it('derives a title from the first line when none is given', async () => {
    const id = await ingestNote('Retrieval notes\n\nThe retriever scans every chunk.');
    const { body } = await api().get(`/api/items/${id}`).expect(200);
    expect(body.item.title).toBe('Retrieval notes');
  });

  it('rejects an empty note with a field-level validation error', async () => {
    const { body } = await api().post('/api/ingest').send({ type: 'note', content: '   ' }).expect(400);

    expect(body.error.code).toBe('validation_error');
    expect(body.error.details[0].field).toBe('content');
    expect(body.error.requestId).toBeTruthy();
  });

  it('rejects an unknown ingest type rather than guessing', async () => {
    const { body } = await api().post('/api/ingest').send({ type: 'pdf', content: 'x' }).expect(400);
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects a non-http URL scheme', async () => {
    const { body } = await api().post('/api/ingest').send({ type: 'url', url: 'ftp://example.com/f' }).expect(400);
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 400 for malformed JSON', async () => {
    const { body } = await api()
      .post('/api/ingest')
      .set('content-type', 'application/json')
      .send('{"type":')
      .expect(400);
    expect(body.error.code).toBe('malformed_json');
  });
});

describe('GET /api/items', () => {
  it('lists newest first and paginates with a cursor', async () => {
    for (const text of ['alpha note', 'beta note', 'gamma note']) await ingestNote(text);

    const first = await api().get('/api/items?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await api().get(`/api/items?limit=2&cursor=${first.body.nextCursor}`).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('filters by status', async () => {
    await ingestNote('indexed already');
    const { body } = await api().get('/api/items?status=failed').expect(200);
    expect(body.items).toEqual([]);
  });

  it('rejects an out-of-range limit', async () => {
    await api().get('/api/items?limit=500').expect(400);
  });
});

describe('GET /api/items/:id', () => {
  it('404s for an unknown but well-formed id', async () => {
    const { body } = await api().get('/api/items/11111111-1111-4111-8111-111111111111').expect(404);
    expect(body.error.code).toBe('not_found');
  });

  it('400s for an id that is not a UUID', async () => {
    const { body } = await api().get('/api/items/not-a-uuid').expect(400);
    expect(body.error.code).toBe('validation_error');
  });

  it('exposes the chunks the retriever sees', async () => {
    const id = await ingestNote('Chunk one content. '.repeat(200));
    const { body } = await api().get(`/api/items/${id}/chunks`).expect(200);

    expect(body.count).toBeGreaterThan(1);
    expect(body.chunks[0]).toHaveProperty('content');
    expect(body.chunks.map((chunk: { position: number }) => chunk.position)).toEqual(
      body.chunks.map((_: unknown, index: number) => index),
    );
  });
});

describe('DELETE /api/items/:id', () => {
  it('removes the item and its chunks from the index', async () => {
    const id = await ingestNote('Disposable note about kubernetes.');
    const before = await api().get('/api/health').expect(200);
    expect(before.body.index.chunks).toBeGreaterThan(0);

    await api().delete(`/api/items/${id}`).expect(204);
    await api().get(`/api/items/${id}`).expect(404);

    const after = await api().get('/api/health').expect(200);
    expect(after.body.index.chunks).toBe(0);
  });

  it('404s when deleting something that is already gone', async () => {
    await api().delete('/api/items/11111111-1111-4111-8111-111111111111').expect(404);
  });
});

describe('POST /api/query', () => {
  it('answers from indexed content and cites its source', async () => {
    await ingestNote(
      'The ingestion queue persists job state in SQLite so an interrupted ingest is recoverable after a restart.',
      'Queue design',
    );

    const { body } = await api()
      .post('/api/query')
      .send({ question: 'where is ingest job state persisted?' })
      .expect(200);

    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations[0]).toMatchObject({ marker: 1, title: 'Queue design' });
    expect(body.sources[0].score).toBeGreaterThan(0);
    expect(body.meta.generator).toBe('stub');
    expect(body.answer).toContain('[1]');
  });

  it('returns 200 with an empty citation list when nothing is indexed', async () => {
    const { body } = await api().post('/api/query').send({ question: 'anything at all?' }).expect(200);

    expect(body.citations).toEqual([]);
    expect(body.sources).toEqual([]);
    expect(body.answer).toMatch(/Nothing has been indexed/i);
  });

  it('can be scoped to specific items', async () => {
    const wanted = await ingestNote('Postgres with pgvector is the production migration path.', 'Scaling');
    await ingestNote('Completely unrelated text about basketball practice.', 'Sport');

    const { body } = await api()
      .post('/api/query')
      .send({ question: 'what is the production migration path?', itemIds: [wanted] })
      .expect(200);

    for (const source of body.sources) expect(source.itemId).toBe(wanted);
  });

  it('rejects a question that is too short', async () => {
    const { body } = await api().post('/api/query').send({ question: 'hi' }).expect(400);
    expect(body.error.details[0].field).toBe('question');
  });
});

describe('GET /api/health', () => {
  it('reports provider wiring and index size', async () => {
    const { body } = await api().get('/api/health').expect(200);

    expect(body.status).toBe('ok');
    expect(body.providers.embeddings.id).toBe('local-hashed-ngram');
    expect(body.providers.chat.remote).toBe(true);
    expect(body.index.items).toMatchObject({ pending: 0, ready: 0, failed: 0 });
  });
});

describe('unknown routes', () => {
  it('404 as JSON, not as an HTML error page', async () => {
    const { body } = await api().get('/api/nope').expect(404);
    expect(body.error.code).toBe('route_not_found');
  });
});
