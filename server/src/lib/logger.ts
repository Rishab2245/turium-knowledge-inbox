import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { config } from '../config/index.js';

/**
 * Structured logging. Every log line is JSON in production so it can be shipped
 * to a log aggregator untouched; in development it is pretty-printed.
 *
 * A request id is carried in AsyncLocalStorage so that background work started
 * by a request (the ingestion pipeline) stays correlated with the HTTP call
 * that triggered it, without threading a logger through every function.
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

const isPretty = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'knowledge-inbox-api' },
  mixin() {
    const store = requestContext.getStore();
    return store ? { requestId: store.requestId } : {};
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.OPENAI_API_KEY'],
    censor: '[redacted]',
  },
  ...(isPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

/** Child logger tagged with the subsystem it belongs to. */
export function loggerFor(component: string) {
  return logger.child({ component });
}
