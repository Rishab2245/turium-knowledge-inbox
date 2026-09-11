import type {
  ApiErrorBody,
  HealthResponse,
  IngestResponse,
  ItemsResponse,
  ItemStatus,
  QueryResponse,
} from './types';

/**
 * Relative by default: in development Vite proxies /api to the server, and in
 * the production image the server serves these assets itself. Set
 * VITE_API_BASE_URL when the API lives on a different origin.
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * Carries the server's machine-readable error code and per-field details
 * through to the UI, so components can show a specific message and quote the
 * request id instead of rendering "something went wrong".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly fieldErrors?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Something the user can fix by editing their input. */
  get isUserFixable(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the API. Is the server running?', 0, 'network_error');
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? 'unknown_error',
      body?.error?.requestId,
      body?.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/api/health', { signal }),

  listItems: (params: { limit?: number; status?: ItemStatus; cursor?: string } = {}, signal?: AbortSignal) => {
    const search = new URLSearchParams();
    if (params.limit) search.set('limit', String(params.limit));
    if (params.status) search.set('status', params.status);
    if (params.cursor) search.set('cursor', params.cursor);
    const suffix = search.size > 0 ? `?${search}` : '';
    return request<ItemsResponse>(`/api/items${suffix}`, { signal });
  },

  ingestNote: (content: string, title?: string) =>
    request<IngestResponse>('/api/ingest', {
      method: 'POST',
      body: { type: 'note', content, ...(title ? { title } : {}) },
    }),

  ingestUrl: (url: string, title?: string) =>
    request<IngestResponse>('/api/ingest', {
      method: 'POST',
      body: { type: 'url', url, ...(title ? { title } : {}) },
    }),

  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),

  query: (question: string, options: { topK?: number; itemIds?: string[] } = {}, signal?: AbortSignal) =>
    request<QueryResponse>('/api/query', {
      method: 'POST',
      body: { question, ...options },
      signal,
    }),
};
