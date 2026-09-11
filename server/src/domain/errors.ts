/**
 * A small error taxonomy. Route handlers throw these; a single error
 * middleware turns them into HTTP responses, so status-code decisions live in
 * one place instead of being scattered across handlers.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
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
  constructor(message: string, details?: unknown) {
    super(message, 502, 'upstream_error', details);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'unprocessable', details);
  }
}
