import type OpenAI from 'openai';
import { UpstreamError } from '../../domain/errors.js';
import { classifyProviderError } from '../classifyProviderError.js';
import { loggerFor } from '../../lib/logger.js';
import { withRetry } from '../../lib/retry.js';
import type { ChatCompletion, ChatMessage, ChatProvider } from './types.js';

const log = loggerFor('llm.openai');

export class OpenAIChatProvider implements ChatProvider {
  readonly isRemote = true;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    /**
     * The vendor actually being called. Every provider here speaks the OpenAI
     * wire format, so hardcoding 'openai' would report Gemini answers as having
     * come from OpenAI in both the API response and the logs.
     */
    readonly id: string = 'openai',
  ) {}

  async complete(messages: ChatMessage[]): Promise<ChatCompletion> {
    // Classified inside the retried operation so withRetry can honour the
    // resulting `retryable` flag rather than guessing from a raw status code.
    const response = await withRetry(
      () =>
        this.client.chat.completions
          .create({
            model: this.model,
            messages,
            // Answers must stay inside the retrieved context; sampling creativity
            // is exactly what causes citation drift.
            temperature: 0.1,
            // Generous because a reasoning model bills its hidden thinking
            // against this budget and returns nothing if it runs out.
            max_tokens: 2000,
          })
          .catch((error: unknown) => {
            throw classifyProviderError(error, { stage: 'chat', model: this.model });
          }),
      { label: 'chat.completions.create', log },
    );

    const choice = response.choices[0];
    const text = choice?.message?.content?.trim();

    if (!text) {
      // Reasoning models can spend the entire output budget on hidden thinking
      // tokens and return a 200 with empty content. Say so, because "empty
      // completion" on its own sends you looking at the prompt instead of the
      // model choice. Observed with Gemini 3.x flash models via the
      // OpenAI-compatible endpoint; flash-lite does not think and is fine.
      throw new UpstreamError(
        'Chat provider returned an empty completion. If this is a reasoning model, its thinking ' +
          'tokens likely consumed the output budget - raise max_tokens or use a non-reasoning model.',
        { model: this.model, finishReason: choice?.finish_reason ?? 'unknown' },
      );
    }

    return { text, model: response.model ?? this.model };
  }
}
