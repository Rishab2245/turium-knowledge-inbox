import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Item } from '../api/types';

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 1500;

interface UseItemsResult {
  items: Item[];
  isLoading: boolean;
  error: string | null;
  /** True while at least one item is still being fetched, chunked or embedded. */
  hasWorkInFlight: boolean;
  refresh: () => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so the polling effect does not re-subscribe on every list
  // change, which would reset the interval on each tick.
  const hasWorkInFlight = items.some((item) => item.status === 'pending' || item.status === 'processing');
  const inFlightRef = useRef(hasWorkInFlight);
  inFlightRef.current = hasWorkInFlight;

  const refresh = useCallback(async () => {
    try {
      const response = await api.listItems({ limit: PAGE_SIZE });
      setItems(response.items);
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof ApiError ? caught.message : 'Could not load saved items.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return { items, isLoading, error, hasWorkInFlight, refresh, addOptimistic, remove };
}
