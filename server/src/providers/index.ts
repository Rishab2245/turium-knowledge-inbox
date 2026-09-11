import OpenAI from 'openai';
import { config } from '../config/index.js';
import { loggerFor } from '../lib/logger.js';
import { LocalEmbeddingProvider } from './embeddings/localEmbeddings.js';
import { OpenAIEmbeddingProvider } from './embeddings/openaiEmbeddings.js';
import type { EmbeddingProvider } from './embeddings/types.js';
import { OpenAIChatProvider } from './llm/openaiChat.js';
import type { ChatProvider } from './llm/types.js';

const log = loggerFor('providers');

export interface Providers {
  embeddings: EmbeddingProvider;
  /** Null when no API key is configured; the RAG layer then answers extractively. */
  chat: ChatProvider | null;
}

/**
 * Single place where "which model do we talk to" is decided.
 *
 * The app is written against an OpenAI-compatible surface rather than OpenAI
 * specifically, so OPENAI_BASE_URL can point at Groq, Together, OpenRouter,
 * Ollama or a local vLLM without touching any other file.
 */
export function createProviders(): Providers {
  if (!config.OPENAI_API_KEY) {
    log.warn(
      'No OPENAI_API_KEY set - falling back to local hashed embeddings and extractive answers. ' +
        'Retrieval works, but answers are stitched from source text rather than generated.',
    );
    return { embeddings: new LocalEmbeddingProvider(), chat: null };
  }

  const client = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    ...(config.OPENAI_BASE_URL ? { baseURL: config.OPENAI_BASE_URL } : {}),
    maxRetries: 0, // retry/backoff is handled centrally in lib/retry.ts
    timeout: 30_000,
  });

  log.info(
    { embeddingModel: config.EMBEDDING_MODEL, chatModel: config.CHAT_MODEL, baseUrl: config.OPENAI_BASE_URL ?? 'default' },
    'using remote model provider',
  );

  return {
    embeddings: new OpenAIEmbeddingProvider(client, config.EMBEDDING_MODEL),
    chat: new OpenAIChatProvider(client, config.CHAT_MODEL),
  };
}

export type { EmbeddingProvider, ChatProvider };
