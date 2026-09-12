import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHealth } from '../src/hooks/useHealth';
import { makeHealth } from './helpers';

/** Collapses the backoff so the retry path is testable in milliseconds. */
const FAST = { retryBaseMs: 10, retryMaxMs: 20 };

const ok = () =>
  new Response(JSON.stringify(makeHealth()), { status: 200, headers: { 'content-type': 'application/json' } });

describe('useHealth', () => {
  it('reports online once the server answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));

    const { result } = renderHook(() => useHealth(0, FAST));

    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(result.current.health?.providers.name).toBe('openai');
  });

  it('stays "connecting" after a single failure rather than crying offline', async () => {
    // A cold-starting host fails its first request routinely. Flashing a red
    // "not reachable" banner at someone whose server is waking up is worse
    // than saying nothing.
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    const { result } = renderHook(() => useHealth(0, FAST));

    await waitFor(() => expect(result.current.health).toBeNull());
    expect(result.current.status).toBe('connecting');
  });

  it('escalates to offline after repeated failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    const { result } = renderHook(() => useHealth(0, FAST));

    await waitFor(() => expect(result.current.status).toBe('offline'));
  });

  /**
   * The bug this exists for: the hook used to fetch exactly once per revision.
   * A redeploy took the server down for a minute, that single check failed, and
   * the UI latched into "API is not reachable" permanently - while the items
   * list, which polls independently, recovered and showed live data underneath
   * the stale error.
   */
  it('recovers on its own once a failing server comes back', async () => {
    // Gated rather than counted: the server stays down until the test brings
    // it back, so there is no race between the backoff and the assertions.
    let serverIsDown = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (serverIsDown) throw new TypeError('Failed to fetch');
        return ok();
      }),
    );

    const { result } = renderHook(() => useHealth(0, FAST));

    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(result.current.health).toBeNull();

    serverIsDown = false;

    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(result.current.health).not.toBeNull();
  });

  it('re-checks when the revision changes', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook((revision: number) => useHealth(revision, FAST), { initialProps: 0 });
    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('does not keep polling a healthy server', async () => {
    // A steady heartbeat would keep a free instance awake and burn its
    // monthly allowance for no new information.
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useHealth(0, FAST));
    await waitFor(() => expect(result.current.status).toBe('online'));

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
