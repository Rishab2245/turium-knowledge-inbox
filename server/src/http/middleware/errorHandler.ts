import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../../config/index.js';
import { AppError } from '../../domain/errors.js';
import { logger } from '../../lib/logger.js';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/**
 * The single place an exception becomes an HTTP response.
 *
 * Every error leaves as the same JSON shape with a stable machine-readable
 * `code`, so the frontend can branch on the code rather than string-matching a
 * message. The request id is echoed into the body so a user can quote it and it
 * can be grepped straight out of the logs.
 */
export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(error);

  const requestId = (res.locals.requestId as string) ?? 'unknown';
  const { status, body } = toResponse(error, requestId);

  const level = status >= 500 ? 'error' : 'warn';
  logger[level](
    {
      requestId,
      method: req.method,
      path: req.path,
      status,
      code: body.error.code,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    },
    'request failed',
  );

  res.status(status).json(body);
}

function toResponse(error: unknown, requestId: string): { status: number; body: ErrorBody } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'validation_error',
          message: 'The request body failed validation',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
          requestId,
        },
      },
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details, requestId } },
    };
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return {
      status: 400,
      body: { error: { code: 'malformed_json', message: 'Request body is not valid JSON', requestId } },
    };
  }

  // Anything unclassified is a bug. Leak nothing about it in production.
  return {
    status: 500,
    body: {
      error: {
        code: 'internal_error',
        message:
          config.NODE_ENV === 'production'
            ? 'Something went wrong. Quote the request id when reporting this.'
            : error instanceof Error
              ? error.message
              : String(error),
        requestId,
      },
    },
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'route_not_found',
      message: `No route matches ${req.method} ${req.path}`,
      requestId: (res.locals.requestId as string) ?? 'unknown',
    },
  });
}
