export type SourceType = 'note' | 'url';
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

export interface Citation {
  marker: number;
  itemId: string;
  chunkId: string;
  title: string;
  url: string | null;
  sourceType: SourceType;
  score: number;
  snippet: string;
}

export interface RetrievedSource {
  chunkId: string;
  itemId: string;
  position: number;
  score: number;
  title: string;
  url: string | null;
  sourceType: SourceType;
  content: string;
}

export interface QueryResponse {
  question: string;
  answer: string;
  citations: Citation[];
  sources: RetrievedSource[];
  meta: {
    generator: string;
    model: string;
    retrievedChunks: number;
    scannedChunks: number;
    topK: number;
    retrievalMs: number;
    answerMs: number;
  };
}

export interface IngestResponse {
  item: Item;
  jobId: string | null;
  deduplicated: boolean;
}

export interface ItemsResponse {
  items: Item[];
  nextCursor: string | null;
  count: number;
}

export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  environment: string;
  providers: {
    name: 'gemini' | 'openai' | 'local';
    embeddings: { id: string; model: string; remote: boolean; dimensions: number | null };
    chat: { id: string; model: string; remote: boolean };
  };
  index: {
    items: Record<ItemStatus, number>;
    chunks: number;
    pendingJobs: number;
    embeddingDimensions: number | null;
  };
  retrieval: { topK: number; chunkSizeChars: number };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId: string;
  };
}
