import OpenAI from "openai";
import { z } from "zod";

import { InferenceMetrics, type ChatModel } from "./types.js";

const CompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          reasoning_content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

const closedReasoningBlock =
  /<(?:think|analysis)>[\s\S]*?<\/(?:think|analysis)>/gi;

function finalContentFromCompletion(
  message: z.infer<
    typeof CompletionResponseSchema
  >["choices"][number]["message"],
): string {
  const content = (message.content ?? "")
    .replace(closedReasoningBlock, "")
    .trim();
  const lastReasoningEnd = Math.max(
    content.toLowerCase().lastIndexOf("</think>"),
    content.toLowerCase().lastIndexOf("</analysis>"),
  );
  const finalContent =
    lastReasoningEnd >= 0
      ? content.slice(content.indexOf(">", lastReasoningEnd) + 1).trim()
      : content;
  if (!finalContent) {
    throw new Error("vLLM returned no final answer content");
  }
  return finalContent;
}

export interface VllmClientOptions {
  apiKey?: string | undefined;
  baseUrl: string;
  maxRetries?: number;
  modelName: string;
  timeoutMs?: number;
}

export class VllmClient implements ChatModel {
  readonly modelName: string;
  readonly metrics: InferenceMetrics;
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(options: VllmClientOptions, fetcher: typeof fetch = fetch) {
    this.modelName = options.modelName;
    this.metrics = new InferenceMetrics(options.modelName);
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? "vllm-no-api-key",
      baseURL: options.baseUrl.replace(/\/$/, ""),
      fetch: fetcher,
      maxRetries: options.maxRetries ?? 2,
      timeout: this.timeoutMs,
    });
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
      const response = await this.client.chat.completions.create(
        {
          messages: [
            { content: systemPrompt, role: "system" },
            { content: userPrompt, role: "user" },
          ],
          model: this.modelName,
          response_format: { type: "json_object" },
          temperature: 0.1,
        },
        { signal: requestSignal },
      );
      const parsed = CompletionResponseSchema.parse(response);
      this.metrics.recordRequest(
        Math.round(performance.now() - startedAt),
        true,
      );
      const message = parsed.choices[0]?.message;
      if (!message) throw new Error("vLLM returned no completion choice");
      return finalContentFromCompletion(message);
    } catch (error) {
      this.metrics.recordRequest(
        Math.round(performance.now() - startedAt),
        false,
      );
      throw error;
    }
  }
}
