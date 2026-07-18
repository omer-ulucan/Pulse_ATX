import { z } from "zod";

const EmbeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({ embedding: z.array(z.number()), index: z.number().int() }),
    )
    .min(1),
});

export interface EmbeddingProvider {
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
}

export interface EmbeddingClientOptions {
  apiKey?: string | undefined;
  baseUrl: string;
  dimensions?: number;
  modelName: string;
  timeoutMs?: number;
}

export class EmbeddingClient implements EmbeddingProvider {
  private readonly dimensions: number;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: EmbeddingClientOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.dimensions = options.dimensions ?? 384;
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/embeddings`;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetcher(this.endpoint, {
      body: JSON.stringify({ input: text, model: this.options.modelName }),
      headers: {
        "Content-Type": "application/json",
        ...(this.options.apiKey
          ? { Authorization: `Bearer ${this.options.apiKey}` }
          : {}),
      },
      method: "POST",
      signal: requestSignal,
    });
    if (!response.ok)
      throw new Error(`Embedding endpoint returned HTTP ${response.status}`);
    const parsed = EmbeddingResponseSchema.parse(await response.json());
    const embedding = parsed.data[0]?.embedding;
    if (!embedding || embedding.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions} embedding dimensions`);
    }
    return embedding;
  }
}
