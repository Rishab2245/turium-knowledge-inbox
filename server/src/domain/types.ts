export type SourceType = 'note' | 'url';

/** Lifecycle of an ingested item. Ingestion is asynchronous, so an item is
 *  visible (and listable) immediately, before its embeddings exist. */
export type ItemStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface Item {
  id: string;
  sourceType: SourceType;
  title: string;
  url: string | null;
  content: string;
  status: ItemStatus;
  error: string | null;
  chunkCount: number;
  charCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Chunk {
  id: string;
  itemId: string;
  position: number;
  content: string;
  charCount: number;
}

export interface ScoredChunk extends Chunk {
  score: number;
  item: Pick<Item, 'id' | 'title' | 'url' | 'sourceType' | 'createdAt'>;
}

export interface Citation {
  /** 1-based marker referenced from the answer text, e.g. "[1]". */
  marker: number;
  itemId: string;
  chunkId: string;
  title: string;
  url: string | null;
  sourceType: SourceType;
  score: number;
  snippet: string;
}

export interface Answer {
  answer: string;
  citations: Citation[];
  /** How the answer text was produced: a chat model, or the no-key fallback. */
  generator: string;
  model: string;
  usedChunks: number;
  latencyMs: number;
}
