export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatCompletion {
  text: string;
  model: string;
}

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  readonly isRemote: boolean;
  complete(messages: ChatMessage[]): Promise<ChatCompletion>;
}
