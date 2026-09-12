import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useItems } from '../src/hooks/useItems';
import { errorResponse, itemsResponse, makeItem, stubFetch } from './helpers';

describe('useItems loading', () => {
  it('loads the first page on mount', async () => {
    const items = [makeItem({ title: 'First' }), makeItem({ title: 'Second' })];
    stubFetch({ 'GET /api/items': () => itemsResponse(items) });

    const { result } = renderHook(() => useItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items.map((item) => item.title)).toEqual(['First', 'Second']);
    expect(result.current.hasMore).toBe(false);
  });

  it('surfaces a load failure', async () => {
    stubFetch({
      'GET /api/items': () =>
        errorResponse(500, { error: { code: 'internal_error', message: 'boom', requestId: 'r' } }),
    });

    const { result } = renderHook(() => useItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('boom');
  });

  it('reports work in flight while anything is pending or processing', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ status: 'pending' }), makeItem({ status: 'ready' })]),
    });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.hasWorkInFlight).toBe(true));
  });
});

describe('useItems pagination', () => {
  it('exposes hasMore when the server returns a cursor', async () => {
    stubFetch({ 'GET /api/items': () => itemsResponse([makeItem()], 'cursor-1') });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.hasMore).toBe(true));
  });

  it('appends the next page and forwards the cursor', async () => {
    const page1 = [makeItem({ id: 'a', title: 'A' })];
    const page2 = [makeItem({ id: 'b', title: 'B' })];

    const { calls } = stubFetch({
      'GET /api/items': (url) => (url.includes('cursor=cursor-1') ? itemsResponse(page2) : itemsResponse(page1, 'cursor-1')),
    });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.loadMore());

    expect(result.current.items.map((item) => item.title)).toEqual(['A', 'B']);
    expect(result.current.hasMore).toBe(false);
    expect(calls.some((call) => call.url.includes('cursor=cursor-1'))).toBe(true);
  });

  it('does not duplicate an item that appears in both pages', async () => {
    // Keyset pagination cannot see that an item shifted across the page
    // boundary between requests, so the hook has to de-duplicate.
    const shared = makeItem({ id: 'shared', title: 'Shared' });

    stubFetch({
      'GET /api/items': (url) =>
        url.includes('cursor=')
          ? itemsResponse([shared, makeItem({ id: 'older', title: 'Older' })])
          : itemsResponse([shared], 'cursor-1'),
    });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.loadMore());

    expect(result.current.items.map((item) => item.id)).toEqual(['shared', 'older']);
  });

  it('does nothing when loadMore is called with no cursor', async () => {
    const { calls } = stubFetch({ 'GET /api/items': () => itemsResponse([makeItem()]) });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const before = calls.length;
    await act(() => result.current.loadMore());

    expect(calls.length).toBe(before);
  });

  /**
   * The bug this pins: a poll that replaced state with page one would silently
   * discard every page the user had already loaded.
   */
  it('keeps later pages when refresh re-reads the first page', async () => {
    const page1 = [makeItem({ id: 'a', title: 'A', status: 'pending' })];
    const page2 = [makeItem({ id: 'b', title: 'B' })];

    stubFetch({
      'GET /api/items': (url) =>
        url.includes('cursor=')
          ? itemsResponse(page2)
          : itemsResponse([{ ...page1[0]!, status: 'ready', chunkCount: 4 }], 'cursor-1'),
    });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(2);

    await act(() => result.current.refresh());

    expect(result.current.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.current.items[0]!.chunkCount).toBe(4); // status update applied
  });
});

describe('useItems mutations', () => {
  it('shows a newly saved item immediately', async () => {
    stubFetch({ 'GET /api/items': () => itemsResponse([]) });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const fresh = makeItem({ id: 'new', title: 'Fresh', status: 'pending' });
    act(() => result.current.addOptimistic(fresh));

    expect(result.current.items[0]!.id).toBe('new');
    expect(result.current.hasWorkInFlight).toBe(true);
  });

  it('ignores an optimistic add for an item already present', async () => {
    const existing = makeItem({ id: 'dupe' });
    stubFetch({ 'GET /api/items': () => itemsResponse([existing]) });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.addOptimistic(existing));
    expect(result.current.items).toHaveLength(1);
  });

  it('removes an item optimistically', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ id: 'gone' }), makeItem({ id: 'stays' })]),
      'DELETE /api/items/gone': () => new Response(null, { status: 204 }),
    });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(() => result.current.remove('gone'));

    expect(result.current.items.map((item) => item.id)).toEqual(['stays']);
  });

  it('rolls the list back when a delete fails', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ id: 'keep' })]),
      'DELETE /api/items/keep': () =>
        errorResponse(500, { error: { code: 'internal_error', message: 'nope', requestId: 'r' } }),
    });

    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await expect(result.current.remove('keep')).rejects.toThrow();
    });

    // The UI must never claim something was deleted when it was not.
    expect(result.current.items.map((item) => item.id)).toEqual(['keep']);
  });
});
