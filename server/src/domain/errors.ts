/**
 * A small error taxonomy. Route handlers throw these; a single error
 * middleware turns them into HTTP responses, so status-code decisions live in
 * one place instead of being scattered across handlers.
 */
export class AppError extends Error {
  /**
   * Whether retrying the operation could plausibly succeed.
   *
   * Carried on the error rather than inferred from the status code, because the
   * two genuinely disagree: a 429 from a daily quota is hopeless until tomorrow
   * while a 429 from a per-minute limit clears in seconds, and a bad API key
   * surfaces as a 5xx from our side but will never fix itself. Server errors
   * default to retryable and client errors do not.
   */
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
    retryable?: boolean,
  ) {
    super(message);
    this.name = new.target.name;
    this.retryable = retryable ?? status >= 500;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'validation_error', details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' was not found`, 404, 'not_found');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'conflict', details);
  }
}

/** The request was fine; a provider we depend on was not. */
export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown, retryable = true) {
    super(message, 502, 'upstream_error', details, retryable);
  }
}

/**
 * The provider refused because the account is out of quota.
 *
 * A 4xx on purpose, which is what stops the ingestion queue retrying it: on a
 * free tier with a daily cap, three automatic retries would burn three more
 * requests to learn the same thing.
 */
export class QuotaExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 429, 'quota_exceeded', details, false);
  }
}

/** The key is missing, wrong, or not entitled to the model. Retrying cannot help. */
export class ProviderAuthError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 502, 'provider_auth_error', details, false);
  }
}

/** A provider hiccup that a retry has a real chance of clearing. */
export class RateLimitedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 429, 'rate_limited', details, true);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'unprocessable', details);
  }
}
