import OpenAI from 'openai';
import { config, looksLikeReasoningModel } from '../config/index.js';
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
 * The app speaks the OpenAI wire format rather than any single vendor's SDK, so
 * one client covers Gemini, OpenAI, Groq, Together, OpenRouter, Ollama and
 * vLLM. Set GEMINI_API_KEY or OPENAI_API_KEY and the rest is defaulted; point
 * OPENAI_BASE_URL somewhere else to use anything that is compatible.
 */
export function createProviders(): Providers {
  const { provider } = config;

  if (provider.name === 'local') {
    log.warn(
      'No GEMINI_API_KEY or OPENAI_API_KEY set - falling back to local hashed embeddings and extractive ' +
        'answers. Retrieval works, but answers are stitched from source text rather than generated.',
    );
    return { embeddings: new LocalEmbeddingProvider(), chat: null };
  }

  const client = new OpenAI({
    apiKey: provider.apiKey!,
    ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
    maxRetries: 0, // retry/backoff is handled centrally in lib/retry.ts
    timeout: 30_000,
  });

  if (provider.name === 'gemini' && looksLikeReasoningModel(provider.chatModel)) {
    log.warn(
      { chatModel: provider.chatModel },
      'this Gemini model reasons before answering and may return an empty completion once its ' +
        'thinking tokens consume the output budget - prefer a flash-lite model',
    );
  }

  log.info(
    {
      provider: provider.name,
      embeddingModel: provider.embeddingModel,
      chatModel: provider.chatModel,
      baseUrl: provider.baseUrl ?? 'default',
      embeddingDimensions: provider.embeddingDimensions ?? 'model default',
    },
    'using remote model provider',
  );

  return {
    embeddings: new OpenAIEmbeddingProvider(client, provider.embeddingModel, provider.embeddingDimensions, provider.name),
    chat: new OpenAIChatProvider(client, provider.chatModel, provider.name),
  };
}

export type { EmbeddingProvider, ChatProvider };
