import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HealthResponse } from '../api/types';

/** Backoff bounds for re-checking a server that is not answering. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 15_000;

/**
 * How many consecutive failures before we call it offline rather than
 * "connecting". A cold-starting host can take the best part of a minute to
 * answer its first request, and flashing a red "not reachable" banner at
 * someone whose server is merely waking up is worse than saying nothing.
 */
const FAILURES_BEFORE_OFFLINE = 2;

export type HealthStatus = 'connecting' | 'online' | 'offline';

/**
 * Reads /api/health, and keeps reading it until it gets an answer.
 *
 * Re-checks whenever `revision` changes, which the app bumps after anything
 * that alters the index.
 *
 * The retry loop is the point. An earlier version fetched exactly once per
 * revision, so a single failure latched the UI into "API is not reachable"
 * for good: a redeploy took the server down for a minute, the health check
 * failed, and nothing ever asked again. The saved-items list polls on its own
 * and recovered, which left the page showing live data underneath a stale
 * error banner. Now a failure schedules another attempt with backoff, so the
 * banner clears itself the moment the server answers.
 *
 * It deliberately does NOT poll while healthy. There is nothing to learn from
 * a server that is already answering, and on a free host a steady heartbeat
 * would keep the instance awake and burn the monthly allowance.
 */
export interface UseHealthOptions {
  /** Overridable so tests can exercise the backoff without waiting on it. */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export function useHealth(
  revision: number,
  options: UseHealthOptions = {},
): { health: HealthResponse | null; status: HealthStatus } {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<HealthStatus>('connecting');

  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? RETRY_MAX_MS;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let failures = 0;

    const check = async (): Promise<void> => {
      try {
        const response = await api.health(controller.signal);
        if (cancelled) return;

        setHealth(response);
        setStatus('online');
        failures = 0;
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;

        failures += 1;
        setStatus(failures >= FAILURES_BEFORE_OFFLINE ? 'offline' : 'connecting');

        const delay = Math.min(retryBaseMs * 2 ** (failures - 1), retryMaxMs);
        timer = setTimeout(() => void check(), delay);
      }
    };

    void check();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [revision, retryBaseMs, retryMaxMs]);

  return { health, status };
}
