export interface EmbeddingProvider {
  /** Stable identifier persisted alongside every vector. */
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  /** True when vectors come from a hosted model rather than the local fallback. */
  readonly isRemote: boolean;
  /** Embeds a batch. Implementations must preserve input order. */
  embed(texts: string[]): Promise<Float32Array[]>;
}
