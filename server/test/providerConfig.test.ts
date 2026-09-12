import { describe, expect, it } from 'vitest';
import { looksLikeReasoningModel, resolveProvider } from '../src/config/index.js';
import {
  AppError,
  ProviderAuthError,
  QuotaExceededError,
  RateLimitedError,
  UpstreamError,
} from '../src/domain/errors.js';
import { classifyProviderError } from '../src/providers/classifyProviderError.js';

/** Only the provider-relevant keys matter; the rest are filled by zod defaults. */
const env = (overrides: Record<string, unknown> = {}) =>
  ({
    NODE_ENV: 'test',
    PORT: 4000,
    LOG_LEVEL: 'silent',
    ...overrides,
  }) as never;

describe('resolveProvider', () => {
  it('falls back to local when no key is set', () => {
    const provider = resolveProvider(env());
    expect(provider.name).toBe('local');
    expect(provider.apiKey).toBeUndefined();
  });

  it('configures Gemini from nothing but the key', () => {
    const provider = resolveProvider(env({ GEMINI_API_KEY: 'g-key' }));

    expect(provider).toMatchObject({
      name: 'gemini',
      apiKey: 'g-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      embeddingModel: 'gemini-embedding-001',
      chatModel: 'gemini-3.1-flash-lite',
    });
  });

  it('configures OpenAI from nothing but the key', () => {
    const provider = resolveProvider(env({ OPENAI_API_KEY: 'o-key' }));

    expect(provider).toMatchObject({
      name: 'openai',
      apiKey: 'o-key',
      embeddingModel: 'text-embedding-3-small',
      chatModel: 'gpt-4o-mini',
    });
    expect(provider.baseUrl).toBeUndefined();
  });

  it('prefers Gemini when both keys are present', () => {
    expect(resolveProvider(env({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' })).name).toBe('gemini');
  });

  it('lets explicit models override the provider defaults', () => {
    const provider = resolveProvider(
      env({ GEMINI_API_KEY: 'g', EMBEDDING_MODEL: 'gemini-embedding-2', CHAT_MODEL: 'gemini-2.5-flash-lite' }),
    );

    expect(provider.embeddingModel).toBe('gemini-embedding-2');
    expect(provider.chatModel).toBe('gemini-2.5-flash-lite');
  });

  it('lets an explicit base url point anywhere OpenAI-compatible', () => {
    // This is what makes Groq, OpenRouter and Ollama work with no extra code.
    const provider = resolveProvider(
      env({ OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://api.groq.com/openai/v1' }),
    );
    expect(provider.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('passes a requested embedding dimension through', () => {
    expect(resolveProvider(env({ GEMINI_API_KEY: 'g', EMBEDDING_DIMENSIONS: 768 })).embeddingDimensions).toBe(768);
  });
});

describe('looksLikeReasoningModel', () => {
  it.each([
    ['gemini-3.1-flash-lite', false],
    ['gemini-2.5-flash-lite', false],
    ['gemini-3.6-flash', true],
    ['gemini-3.5-flash', true],
    ['gemini-3.1-pro-preview', true],
    ['gpt-4o-mini', false],
    ['text-embedding-3-small', false],
  ])('classifies %s as reasoning=%s', (model, expected) => {
    expect(looksLikeReasoningModel(model)).toBe(expected);
  });
});

describe('classifyProviderError', () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { status });

  it('treats a daily quota 429 as permanent so retries do not burn more requests', () => {
    const classified = classifyProviderError(
      err(429, 'Quota exceeded for quota metric generate_requests_per_model_per_day'),
    );

    expect(classified).toBeInstanceOf(QuotaExceededError);
    expect(classified.retryable).toBe(false);
    expect(classified.status).toBe(429);
  });

  it('treats a burst 429 as retryable', () => {
    const classified = classifyProviderError(err(429, 'Too many requests, please slow down'));

    expect(classified).toBeInstanceOf(RateLimitedError);
    expect(classified.retryable).toBe(true);
  });

  it('recognises RESOURCE_EXHAUSTED even without a status', () => {
    expect(classifyProviderError(new Error('RESOURCE_EXHAUSTED: slow down'))).toBeInstanceOf(RateLimitedError);
  });

  it('treats a bad key as permanent', () => {
    for (const status of [401, 403]) {
      const classified = classifyProviderError(err(status, 'API key not valid'));
      expect(classified).toBeInstanceOf(ProviderAuthError);
      expect(classified.retryable).toBe(false);
    }
  });

  it('treats an unavailable model as permanent and names the culprit setting', () => {
    const classified = classifyProviderError(err(404, 'models/gemini-2.5-flash is no longer available to new users'));

    expect(classified).toBeInstanceOf(ProviderAuthError);
    expect(classified.retryable).toBe(false);
    expect(classified.message).toMatch(/CHAT_MODEL/);
  });

  it('treats a 400 as permanent, since the same request would be rejected again', () => {
    expect(classifyProviderError(err(400, 'invalid request')).retryable).toBe(false);
  });

  it('treats a 500 and a bare network failure as retryable', () => {
    expect(classifyProviderError(err(500, 'internal')).retryable).toBe(true);
    expect(classifyProviderError(new Error('socket hang up')).retryable).toBe(true);
  });

  it('reads the message out of a nested provider error body', () => {
    const classified = classifyProviderError({ status: 429, error: { message: 'limit per day reached' } });
    expect(classified).toBeInstanceOf(QuotaExceededError);
  });

  it('does not re-wrap an already classified error', () => {
    const original = new UpstreamError('already classified');
    expect(classifyProviderError(original)).toBe(original);
  });

  it('keeps the calling context in the details for the logs', () => {
    const classified = classifyProviderError(err(500, 'boom'), { stage: 'embeddings', model: 'm', batchSize: 12 });
    expect(classified.details).toMatchObject({ stage: 'embeddings', model: 'm', batchSize: 12, providerStatus: 500 });
  });

  it('always produces an AppError, whatever it was handed', () => {
    for (const input of [undefined, null, 'a string', 42, {}]) {
      expect(classifyProviderError(input)).toBeInstanceOf(AppError);
    }
  });
});
