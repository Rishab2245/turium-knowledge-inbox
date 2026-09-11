import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkRepository } from '../src/db/chunkRepository.js';
import { openDatabase, type Db } from '../src/db/index.js';
import { ItemRepository } from '../src/db/itemRepository.js';
import { JobRepository } from '../src/db/jobRepository.js';
import { UnprocessableError } from '../src/domain/errors.js';
import { IngestionQueue } from '../src/ingestion/queue.js';
import type { IngestionPipeline } from '../src/ingestion/pipeline.js';

let db: Db;
let items: ItemRepository;
let jobs: JobRepository;
let chunks: ChunkRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  items = new ItemRepository(db);
  jobs = new JobRepository(db);
  chunks = new ChunkRepository(db);
});

afterEach(() => db.close());

const newItem = () => items.create({ sourceType: 'note', title: 'test', url: null, content: 'body' });

/** Minimal pipeline stub: records calls and fails in whatever way a test needs. */
function stubPipeline(behaviour: (attempt: number) => void | never): {
  pipeline: IngestionPipeline;
  calls: () => number;
} {
  let calls = 0;
  const pipeline = {
    async run(itemId: string) {
      calls += 1;
      behaviour(calls);
      return { itemId, chunkCount: 1, charCount: 4 };
    },
  } as unknown as IngestionPipeline;

  return { pipeline, calls: () => calls };
}

describe('IngestionQueue', () => {
  it('runs a queued job and marks the item ready through the pipeline', async () => {
    const { pipeline, calls } = stubPipeline(() => {});
    const queue = new IngestionQueue(jobs, items, pipeline);
    const item = newItem();

    queue.enqueue(item.id);
    await queue.drain();

    expect(calls()).toBe(1);
    expect(jobs.pendingCount()).toBe(0);
  });

  it('retries a transient failure up to the attempt budget', async () => {
    const { pipeline, calls } = stubPipeline((attempt) => {
      if (attempt < 3) throw new Error('upstream hiccup');
    });
    const queue = new IngestionQueue(jobs, items, pipeline);
    const item = newItem();

    queue.enqueue(item.id);
    await queue.drain();

    expect(calls()).toBe(3);
    expect(items.getById(item.id)!.status).not.toBe('failed');
  });

  it('does not retry a permanent 4xx failure', async () => {
    const { pipeline, calls } = stubPipeline(() => {
      throw new UnprocessableError('Fetching the URL returned HTTP 404');
    });
    const queue = new IngestionQueue(jobs, items, pipeline);
    const item = newItem();

    queue.enqueue(item.id);
    await queue.drain();

    expect(calls()).toBe(1);

    const failed = items.getById(item.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('404');
  });

  it('marks the item failed once the retry budget is exhausted', async () => {
    const { pipeline, calls } = stubPipeline(() => {
      throw new Error('always broken');
    });
    const queue = new IngestionQueue(jobs, items, pipeline);
    const item = newItem();

    queue.enqueue(item.id);
    await queue.drain();

    expect(calls()).toBe(3);
    expect(items.getById(item.id)!.status).toBe('failed');
  });

  it('processes several items without leaving anything queued', async () => {
    const { pipeline, calls } = stubPipeline(() => {});
    const queue = new IngestionQueue(jobs, items, pipeline);

    for (let i = 0; i < 5; i += 1) queue.enqueue(newItem().id);
    await queue.drain();

    expect(calls()).toBe(5);
    expect(jobs.pendingCount()).toBe(0);
  });

  it('requeues jobs that a previous process left running', async () => {
    const item = newItem();
    const job = jobs.enqueue(item.id);
    jobs.claimNext(); // simulate a crash mid-job

    const { pipeline, calls } = stubPipeline(() => {});
    const queue = new IngestionQueue(jobs, items, pipeline);

    expect(queue.recover()).toBe(1);
    await queue.drain();

    expect(calls()).toBe(1);
    expect(job.itemId).toBe(item.id);
  });

  it('claims each job exactly once when workers race', () => {
    const first = newItem();
    jobs.enqueue(first.id);

    expect(jobs.claimNext()?.itemId).toBe(first.id);
    expect(jobs.claimNext()).toBeNull();
    expect(chunks.count()).toBe(0);
  });
});
