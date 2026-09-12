import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Item } from '../api/types';

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 1500;

interface UseItemsResult {
  items: Item[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  /** True while at least one item is still being fetched, chunked or embedded. */
  hasWorkInFlight: boolean;
  /** Non-null when the server has more items than are currently loaded. */
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  addOptimistic: (item: Item) => void;
  remove: (id: string) => Promise<void>;
}

/**
 * Owns the saved-items list.
 *
 * Ingestion is asynchronous, so the list has to converge on its own: a newly
 * saved item appears immediately as `pending` and the hook polls until nothing
 * is in flight, then stops. Polling rather than websockets is the honest
 * tradeoff for a single-user app - one endpoint, no connection lifecycle, and
 * the poll switches itself off the moment everything is `ready`.
 */
export function useItems(): UseItemsResult {
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so the polling effect does not re-subscribe on every list
  // change, which would reset the interval on each tick.
  const hasWorkInFlight = items.some((item) => item.status === 'pending' || item.status === 'processing');
  const inFlightRef = useRef(hasWorkInFlight);
  inFlightRef.current = hasWorkInFlight;

  /**
   * Re-reads the first page and merges it over what is already loaded.
   *
   * Merging rather than replacing is the whole point: once the user has paged
   * further down, a poll that replaced state with page one would silently throw
   * away every later page. Items are newest-first and only freshly ingested
   * items change status, so the first page always covers everything that can
   * have moved.
   */
  const refresh = useCallback(async () => {
    try {
      const response = await api.listItems({ limit: PAGE_SIZE });

      setItems((current) => {
        const fresh = new Set(response.items.map((item) => item.id));
        const tail = current.filter((item) => !fresh.has(item.id));
        return [...response.items, ...tail];
      });

      // Only adopt the server's cursor when nothing is paged in behind it;
      // otherwise it would rewind pagination to the end of page one.
      setNextCursor((current) => (items.length > response.items.length ? current : response.nextCursor));
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof ApiError ? caught.message : 'Could not load saved items.');
    } finally {
      setIsLoading(false);
    }
    // `items.length` is read above only to decide whether to rewind the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const response = await api.listItems({ limit: PAGE_SIZE, cursor: nextCursor });

      // De-duplicate on id: an item ingested between the two requests shifts
      // the window, and keyset pagination cannot see that it already appeared.
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...response.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(response.nextCursor);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load more items.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor]);

  useEffect(() => {
    void api
      .listItems({ limit: PAGE_SIZE })
      .then((response) => {
        setItems(response.items);
        setNextCursor(response.nextCursor);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load saved items.');
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!hasWorkInFlight) return;
    const timer = setInterval(() => {
      if (inFlightRef.current) void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasWorkInFlight, refresh]);

  const addOptimistic = useCallback((item: Item) => {
    setItems((current) => (current.some((existing) => existing.id === item.id) ? current : [item, ...current]));
  }, []);

  // Optimistic delete needs the pre-delete list to roll back to.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const remove = useCallback(async (id: string) => {
    const snapshot = itemsRef.current;
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      await api.deleteItem(id);
    } catch (caught) {
      setItems(snapshot); // roll back so the UI never lies about what is saved
      throw caught;
    }
  }, []);

  return {
    items,
    isLoading,
    isLoadingMore,
    error,
    hasWorkInFlight,
    hasMore: nextCursor !== null,
    refresh,
    loadMore,
    addOptimistic,
    remove,
  };
}
