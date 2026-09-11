import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { QueryResponse } from '../api/types';

interface UseAskResult {
  result: QueryResponse | null;
  isAsking: boolean;
  error: string | null;
  ask: (question: string, options?: { itemIds?: string[] }) => Promise<void>;
  reset: () => void;
}

/**
 * Owns one question-and-answer exchange.
 *
 * A new question aborts the previous request. Without that, a slow first answer
 * can land after a fast second one and overwrite it - the classic race that
 * makes a search box show the wrong result.
 */
export function useAsk(): UseAskResult {
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const ask = useCallback(async (question: string, options: { itemIds?: string[] } = {}) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setIsAsking(true);
    setError(null);

    try {
      const response = await api.query(question, options, controller.signal);
      if (controller.signal.aborted) return;
      setResult(response);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof ApiError ? caught.message : 'The question could not be answered right now.');
      setResult(null);
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setIsAsking(false);
      }
    }
  }, []);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setResult(null);
    setError(null);
    setIsAsking(false);
  }, []);

  return { result, isAsking, error, ask, reset };
}
