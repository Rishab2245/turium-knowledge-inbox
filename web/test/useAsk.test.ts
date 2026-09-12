import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsk } from '../src/hooks/useAsk';
import { errorResponse, makeQueryResponse, stubFetch } from './helpers';

describe('useAsk', () => {
  it('stores the answer returned for a question', async () => {
    stubFetch({ 'POST /api/query': () => makeQueryResponse() });

    const { result } = renderHook(() => useAsk());
    await act(() => result.current.ask('where are vectors stored?'));

    expect(result.current.result?.answer).toBe('They live in SQLite [1].');
    expect(result.current.isAsking).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('forwards scoping options to the API', async () => {
    const { calls } = stubFetch({ 'POST /api/query': () => makeQueryResponse() });

    const { result } = renderHook(() => useAsk());
    await act(() => result.current.ask('scoped question', { itemIds: ['item-7'] }));

    expect(calls[0]!.body).toMatchObject({ question: 'scoped question', itemIds: ['item-7'] });
  });

  /**
   * The race this guards against: a slow first answer landing after a fast
   * second one and overwriting it, so the UI shows the wrong answer for the
   * question on screen.
   */
  it('discards a slow answer when a newer question has been asked', async () => {
    const resolvers: Array<(value: unknown) => void> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body)) as { question: string };
        return new Promise((resolve, reject) => {
          init!.signal?.addEventListener('abort', () => {
            reject(Object.assign(new DOMException('aborted', 'AbortError')));
          });
          resolvers.push(() =>
            resolve(
              new Response(JSON.stringify(makeQueryResponse({ answer: `answer for ${body.question}` })), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            ),
          );
        });
      }),
    );

    const { result } = renderHook(() => useAsk());

    let firstAsk!: Promise<void>;
    let secondAsk!: Promise<void>;

    act(() => {
      firstAsk = result.current.ask('slow question');
    });
    act(() => {
      secondAsk = result.current.ask('fast question');
    });

    // Resolve the second request, then the first, so the stale one lands last.
    await act(async () => {
      resolvers[1]!(undefined);
      await secondAsk;
    });
    await act(async () => {
      resolvers[0]?.(undefined);
      await firstAsk;
    });

    expect(result.current.result?.answer).toBe('answer for fast question');
  });

  it('surfaces the server message for a rejected question', async () => {
    stubFetch({
      'POST /api/query': () =>
        errorResponse(400, {
          error: {
            code: 'validation_error',
            message: 'The request body failed validation',
            details: [{ field: 'question', message: 'question must be at least 3 characters' }],
            requestId: 'req-1',
          },
        }),
    });

    const { result } = renderHook(() => useAsk());
    await act(() => result.current.ask('hi'));

    expect(result.current.error).toBe('The request body failed validation');
    expect(result.current.result).toBeNull();
  });

  it('reports an unreachable API rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    const { result } = renderHook(() => useAsk());
    await act(() => result.current.ask('anything at all'));

    expect(result.current.error).toMatch(/Could not reach the API/i);
  });

  it('clears state on reset', async () => {
    stubFetch({ 'POST /api/query': () => makeQueryResponse() });

    const { result } = renderHook(() => useAsk());
    await act(() => result.current.ask('where are vectors stored?'));
    expect(result.current.result).not.toBeNull();

    act(() => result.current.reset());

    await waitFor(() => {
      expect(result.current.result).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isAsking).toBe(false);
    });
  });
});
