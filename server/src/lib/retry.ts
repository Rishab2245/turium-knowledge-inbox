import type { Logger } from 'pino';

interface RetryOptions {
  label: string;
  log: Logger;
  attempts?: number;
  baseDelayMs?: number;
}

/**
 * Retries transient upstream failures with exponential backoff and jitter.
 *
 * Only retries what is plausibly transient: network errors, 429 and 5xx.
 * A 400 or 401 is a bug or a bad key, and retrying it just burns time and
 * makes the real error arrive later.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) break;

      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      options.log.warn(
        { label: options.label, attempt, attempts, delayMs: Math.round(delay), err: describe(error) },
        'upstream call failed, retrying',
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500;

  const code = (error as { code?: string })?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
