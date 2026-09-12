import {
  AppError,
  ProviderAuthError,
  QuotaExceededError,
  RateLimitedError,
  UpstreamError,
} from '../domain/errors.js';

/**
 * Daily-cap language, as opposed to a per-minute burst limit.
 *
 * This distinction is the whole point of the module. Google returns 429 for
 * both, but they need opposite handling: a per-minute limit clears in seconds
 * and should be retried, while a daily cap will not clear until tomorrow and
 * retrying it three times on a free tier burns three more requests to learn
 * exactly nothing. Matching on the message is unlovely, but the alternative is
 * treating every 429 as retryable, which is actively harmful on a free key.
 */
const DAILY_QUOTA_PATTERN =
  /per\s*day|perday|daily\s*(limit|quota)|quota.*exceed|exceeded.*quota|billing|insufficient[_\s]?quota|free[_\s]?tier/i;

const AUTH_PATTERN = /api[_\s]?key|unauthorized|unauthenticated|permission|forbidden|invalid.*credential/i;

interface ProviderErrorShape {
  status?: number;
  code?: string;
  message?: string;
  error?: { message?: string; status?: string };
}

/**
 * Maps a provider SDK error onto the app's error taxonomy, so callers get a
 * sensible HTTP status, a stable code, and a truthful `retryable` flag.
 *
 * `context` is folded into the details for the logs (which model, how big a
 * batch) - the kind of thing you want when an ingest fails at 3am.
 */
export function classifyProviderError(error: unknown, context: Record<string, unknown> = {}): AppError {
  // Already classified - do not re-wrap and lose the retry decision.
  if (error instanceof AppError) return error;

  const shaped = (error ?? {}) as ProviderErrorShape;
  const status = typeof shaped.status === 'number' ? shaped.status : undefined;
  const message = shaped.error?.message ?? shaped.message ?? String(error);
  const details = { ...context, ...(status ? { providerStatus: status } : {}) };

  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message)) {
    if (DAILY_QUOTA_PATTERN.test(message)) {
      return new QuotaExceededError(
        `The model provider is out of quota: ${message}. Free tiers reset daily; add billing or wait.`,
        details,
      );
    }
    return new RateLimitedError(`The model provider is rate limiting requests: ${message}`, details);
  }

  if (status === 401 || status === 403 || (status === undefined && AUTH_PATTERN.test(message))) {
    return new ProviderAuthError(
      `The model provider rejected the credentials: ${message}. Check GEMINI_API_KEY or OPENAI_API_KEY.`,
      details,
    );
  }

  // A 404 from a chat or embeddings call means the model name is wrong or the
  // account is not entitled to it. Retrying will not conjure the model.
  if (status === 404) {
    return new ProviderAuthError(
      `The model provider does not have that model available: ${message}. Check EMBEDDING_MODEL and CHAT_MODEL.`,
      details,
    );
  }

  if (status === 400) {
    // A 400 means we sent something the provider would reject again.
    return new UpstreamError(`The model provider rejected the request: ${message}`, details, false);
  }

  return new UpstreamError(`Model provider call failed: ${message}`, details);
}
