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

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new UpstreamError('Chat provider returned an empty completion', { model: this.model });

    return { text, model: response.model ?? this.model };
  }
}
