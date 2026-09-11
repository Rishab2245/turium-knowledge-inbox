import { z } from 'zod';

/**
 * All environment access is funnelled through this module so the rest of the
 * codebase can depend on a typed, validated object instead of `process.env`.
 * Invalid configuration fails fast at boot rather than at the first request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Storage
  DATABASE_PATH: z.string().default('./data/knowledge-inbox.db'),

  // LLM / embedding provider. Any OpenAI-compatible endpoint works
  // (OpenAI, Groq, Together, OpenRouter, Ollama, vLLM, ...).
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  CHAT_MODEL: z.string().default('gpt-4o-mini'),

  // Retrieval + chunking knobs. Exposed because the "right" value is
  // corpus-dependent and reviewers should be able to try alternatives.
  CHUNK_SIZE_CHARS: z.coerce.number().int().positive().default(1100),
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().nonnegative().default(180),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(6),
  RETRIEVAL_CANDIDATE_MULTIPLIER: z.coerce.number().int().positive().default(4),
  MIN_RELEVANCE_SCORE: z.coerce.number().default(0.05),

  // Ingestion safety limits.
  MAX_NOTE_CHARS: z.coerce.number().int().positive().default(100_000),
  MAX_URL_BYTES: z.coerce.number().int().positive().default(2_000_000),
  URL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  INGEST_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MAX_JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),

  CORS_ORIGIN: z.string().default('*'),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  /** True when a real LLM/embedding provider is reachable. */
  hasRemoteProvider: boolean;
};

function build(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${detail}`);
  }
  return { ...parsed.data, hasRemoteProvider: Boolean(parsed.data.OPENAI_API_KEY) };
}

export const config: AppConfig = build();
