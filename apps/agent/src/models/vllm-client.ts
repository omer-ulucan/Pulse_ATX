import { z } from "zod";

import { InferenceMetrics, type ChatModel } from "./types.js";

const CompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().min(1) }),
      }),
    )
    .min(1),
});

export interface VllmClientOptions {
  apiKey?: string | undefined;
  baseUrl: string;
  modelName: string;
  timeoutMs?: number;
}

export class VllmClient implements ChatModel {
  readonly modelName: string;
  readonly metrics: InferenceMetrics;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: VllmClientOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.modelName = options.modelName;
    this.metrics = new InferenceMetrics(options.modelName);
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const startedAt = performance.now();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetcher(this.endpoint, {
        body: JSON.stringify({
          messages: [
            { content: systemPrompt, role: "system" },
            { content: userPrompt, role: "user" },
          ],
          model: this.modelName,
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
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
        throw new Error(`vLLM returned HTTP ${response.status}`);
      const parsed = CompletionResponseSchema.parse(await response.json());
      this.metrics.recordRequest(
        Math.round(performance.now() - startedAt),
        true,
      );
      return parsed.choices[0]?.message.content ?? "";
    } catch (error) {
      this.metrics.recordRequest(
        Math.round(performance.now() - startedAt),
        false,
      );
      throw error;
    }
  }
}
