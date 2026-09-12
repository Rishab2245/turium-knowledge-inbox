import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement fetch. Every test stubs it explicitly, so an
// unstubbed call should fail loudly rather than hit the network.
if (!globalThis.fetch) {
  globalThis.fetch = (() => {
    throw new Error('fetch was called without a stub - stub it in the test');
  }) as typeof fetch;
}
