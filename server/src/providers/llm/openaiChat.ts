import type OpenAI from 'openai';
import { UpstreamError } from '../../domain/errors.js';
import { loggerFor } from '../../lib/logger.js';
import { withRetry } from '../../lib/retry.js';
import type { ChatCompletion, ChatMessage, ChatProvider } from './types.js';

const log = loggerFor('llm.openai');

export class OpenAIChatProvider implements ChatProvider {
  readonly id = 'openai';
  readonly isRemote = true;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {}

  async complete(messages: ChatMessage[]): Promise<ChatCompletion> {
    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.model,
          messages,
          // Answers must stay inside the retrieved context; sampling creativity
          // is exactly what causes citation drift.
          temperature: 0.1,
          max_tokens: 700,
        }),
      { label: 'chat.completions.create', log },
    ).catch((error: unknown) => {
      throw new UpstreamError(
        `Chat provider failed: ${error instanceof Error ? error.message : String(error)}`,
        { model: this.model },
      );
    });

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
