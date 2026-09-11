import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HealthResponse } from '../api/types';

/**
 * Reads /api/health once on mount, and again whenever `revision` changes.
 *
 * The UI uses this for two things: telling the user up front that answers will
 * be extractive because no chat model is configured, and showing how much is
 * actually indexed. Both are questions people otherwise answer by reading
 * server logs.
 */
export function useHealth(revision: number): { health: HealthResponse | null; isOffline: boolean } {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    api
      .health(controller.signal)
      .then((response) => {
        setHealth(response);
        setIsOffline(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setIsOffline(true);
      });

    return () => controller.abort();
  }, [revision]);

  return { health, isOffline };
}
