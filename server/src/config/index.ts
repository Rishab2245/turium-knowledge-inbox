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

  // Model provider. Set exactly one key; everything else has a sensible
  // per-provider default. Gemini and OpenAI both speak the OpenAI wire format,
  // as do Groq, Together, OpenRouter, Ollama and vLLM via OPENAI_BASE_URL.
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  // Left optional so "unset" is distinguishable from "set to the OpenAI
  // default" - the provider picks the right model for whichever key is present.
  EMBEDDING_MODEL: z.string().trim().min(1).optional(),
  CHAT_MODEL: z.string().trim().min(1).optional(),
  // Only sent when set. Some models (gemini-embedding-001, text-embedding-3-*)
  // can return a reduced vector, which shrinks the index and the scan.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),

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

export type ProviderName = 'gemini' | 'openai' | 'local';

export interface ResolvedProvider {
  name: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  embeddingModel: string;
  chatModel: string;
  embeddingDimensions?: number;
}

/**
 * Per-provider defaults, so a single API key is all the configuration anyone
 * needs. Both providers are reached through the same OpenAI-compatible client.
 */
const PROVIDER_DEFAULTS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    embeddingModel: 'gemini-embedding-001',
    // Deliberately flash-LITE. Gemini 3.x "flash" and "pro" are reasoning
    // models: they spend the output budget on hidden thinking tokens and return
    // a 200 with empty content. flash-lite does not think, so it answers.
    chatModel: 'gemini-3.1-flash-lite',
  },
  openai: {
    baseUrl: undefined,
    embeddingModel: 'text-embedding-3-small',
    chatModel: 'gpt-4o-mini',
  },
} as const;

/**
 * Gemini model families that reason before answering. Used only to warn at
 * boot, since the list will drift and a warning is cheaper to be wrong about
 * than a hard refusal.
 */
const REASONING_MODEL_PATTERN = /^gemini-(?!.*flash-lite)(?:[3-9]|\d\d)/i;

export type AppConfig = z.infer<typeof EnvSchema> & {
  /** True when a real LLM/embedding provider is reachable. */
  hasRemoteProvider: boolean;
  provider: ResolvedProvider;
};

/**
 * Resolves which provider to talk to from whichever key is present.
 *
 * Gemini wins when both keys are set, because someone who bothered to set
 * GEMINI_API_KEY on top of an OpenAI key is expressing a preference. An
 * explicit OPENAI_BASE_URL always overrides the provider default, which is what
 * makes Groq, OpenRouter and Ollama work without any provider-specific code.
 */
export function resolveProvider(env: z.infer<typeof EnvSchema>): ResolvedProvider {
  if (env.GEMINI_API_KEY) {
    return {
      name: 'gemini',
      apiKey: env.GEMINI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? PROVIDER_DEFAULTS.gemini.baseUrl,
      embeddingModel: env.EMBEDDING_MODEL ?? PROVIDER_DEFAULTS.gemini.embeddingModel,
      chatModel: env.CHAT_MODEL ?? PROVIDER_DEFAULTS.gemini.chatModel,
      embeddingDimensions: env.EMBEDDING_DIMENSIONS,
    };
  }

  if (env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      embeddingModel: env.EMBEDDING_MODEL ?? PROVIDER_DEFAULTS.openai.embeddingModel,
      chatModel: env.CHAT_MODEL ?? PROVIDER_DEFAULTS.openai.chatModel,
      embeddingDimensions: env.EMBEDDING_DIMENSIONS,
    };
  }

  return { name: 'local', embeddingModel: 'local-hashed-ngram-512', chatModel: 'none' };
}

/** True when the configured chat model is likely to think instead of answer. */
export const looksLikeReasoningModel = (model: string): boolean => REASONING_MODEL_PATTERN.test(model);

function build(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${detail}`);
  }

  const provider = resolveProvider(parsed.data);
  return { ...parsed.data, provider, hasRemoteProvider: provider.name !== 'local' };
}

export const config: AppConfig = build();
