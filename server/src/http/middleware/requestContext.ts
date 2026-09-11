import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger, requestContext } from '../../lib/logger.js';

/**
 * Assigns a request id (honouring an inbound `x-request-id` from a proxy),
 * echoes it on the response, and binds it to the async context so every log
 * line produced while handling the request carries it.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get('x-request-id');
  const requestId = inbound && inbound.length <= 200 ? inbound : randomUUID();

  res.setHeader('x-request-id', requestId);
  res.locals.requestId = requestId;

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      {
        requestId,
        method: req.method,
        path: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      'request completed',
    );
  });

  requestContext.run({ requestId }, () => next());
}
