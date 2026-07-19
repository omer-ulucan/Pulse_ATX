import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { normalizeAustinTrafficFeed } from "../src/feeds/austin-traffic.js";
import type { ChatModel } from "../src/models/types.js";
import { VllmClient } from "../src/models/vllm-client.js";
import { MemoryAnalysisRepository } from "../src/repositories/memory-analysis-repository.js";
import { AnalysisProcessor } from "../src/services/analysis-processor.js";
import { NemotronAnalyzer } from "../src/services/nemotron-analyzer.js";

const validDecision = {
  affected_entities: [{ name: "North Lamar Boulevard", type: "road" }],
  confidence: 0.87,
  evidence: ["Traffic feed reports two blocked lanes"],
  incident_type: "lane_blocking_collision",
  memory_effect: {
    adjusted_prediction_minutes: 38,
    base_prediction_minutes: 38,
    similar_incident_count: 0,
    used_historical_memory: false,
  },
  predicted_duration_minutes: 38,
  recommended_actions: ["Monitor lane clearance"],
  requires_human_approval: false,
  severity: 4,
  summary: "A lane-blocking collision is disrupting North Lamar Boulevard.",
  title: "Collision blocking North Lamar lanes",
};

async function loadTrafficPayload(name: string) {
  const [event] = normalizeAustinTrafficFeed(
    JSON.parse(
      await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
    ) as unknown,
  );
  if (!event) throw new Error(`Fixture ${name} contained no traffic event`);
  return event.payload;
}

class MockChatModel implements ChatModel {
  readonly modelName = "nemotron-mock";
  readonly prompts: string[] = [];

  constructor(private readonly responses: (Error | string)[]) {}

  complete(_systemPrompt: string, userPrompt: string): Promise<string> {
    this.prompts.push(userPrompt);
    const response = this.responses.shift() ?? new Error("No mock response");
    return response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response);
  }
}

describe("Nemotron analysis", () => {
  it("sends an OpenAI-compatible vLLM request", async () => {
    let authorizationHeader = "";
    let requestUrl = "";
    let requestBody: unknown;
    const fetcher: typeof fetch = (input, init) => {
      requestUrl =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      if (typeof init?.body !== "string")
        throw new Error("Expected a JSON request body");
      authorizationHeader =
        new Headers(init.headers).get("authorization") ?? "";
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validDecision) } }],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    };
    const client = new VllmClient(
      {
        apiKey: "test-vllm-token",
        baseUrl: "http://vllm.test/v1",
        modelName: "nemotron-test",
      },
      fetcher,
    );

    await expect(client.complete("system", "user")).resolves.toContain(
      "lane_blocking_collision",
    );
    expect(requestUrl).toBe("http://vllm.test/v1/chat/completions");
    expect(authorizationHeader).toBe("Bearer test-vllm-token");
    expect(requestBody).toMatchObject({
      model: "nemotron-test",
      response_format: { type: "json_object" },
    });
    expect(client.metrics.snapshot()).toMatchObject({
      requests: 1,
      serverStatus: "available",
    });
  });

  it("returns only final content when vLLM separates the reasoning trace", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(validDecision),
                  reasoning_content:
                    "I should classify the blocked lanes before answering.",
                },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    const client = new VllmClient(
      { baseUrl: "http://vllm.test/v1", modelName: "nemotron-test" },
      fetcher,
    );

    const result = await client.complete("system", "user");

    expect(result).toBe(JSON.stringify(validDecision));
    expect(result).not.toContain("blocked lanes before answering");
  });

  it("removes tagged reasoning emitted before the final JSON", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `<think>Private reasoning trace</think>${JSON.stringify(validDecision)}`,
                },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    const client = new VllmClient(
      { baseUrl: "http://vllm.test/v1", modelName: "nemotron-test" },
      fetcher,
    );

    await expect(client.complete("system", "user")).resolves.toBe(
      JSON.stringify(validDecision),
    );
  });

  it("never substitutes a reasoning trace for a missing final answer", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: "Private reasoning without a final answer",
                },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    const client = new VllmClient(
      { baseUrl: "http://vllm.test/v1", modelName: "nemotron-test" },
      fetcher,
    );

    await expect(client.complete("system", "user")).rejects.toThrow(
      "vLLM returned no final answer content",
    );
  });

  it("repairs invalid JSON once and persists the validated decision", async () => {
    const model = new MockChatModel([
      "not-json",
      JSON.stringify(validDecision),
    ]);
    const repository = new MemoryAnalysisRepository();
    repository.addJob(await loadTrafficPayload("austin-traffic-changed.json"));
    const processor = new AnalysisProcessor(
      repository,
      new NemotronAnalyzer(model),
      "test-worker",
    );

    await expect(processor.processBatch()).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
    });
    expect(model.prompts).toHaveLength(2);
    expect(model.prompts[1]).toContain("Repair it");
    expect(repository.persisted[0]).toMatchObject({
      decision: { severity: 4, title: "Collision blocking North Lamar lanes" },
      usedFallback: false,
    });
  });

  it("uses a deterministic fallback after two invalid responses", async () => {
    const repository = new MemoryAnalysisRepository();
    repository.addJob(await loadTrafficPayload("austin-traffic.json"));
    const analyzer = new NemotronAnalyzer(
      new MockChatModel(["{", "still invalid"]),
    );
    const processor = new AnalysisProcessor(
      repository,
      analyzer,
      "test-worker",
    );

    await expect(processor.processBatch()).resolves.toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(repository.persisted[0]).toMatchObject({
      decision: { severity: 4 },
      usedFallback: true,
    });
    expect(analyzer.metrics.snapshot()).toMatchObject({
      eventsProcessed: 1,
      failedStructuredOutputs: 1,
    });
  });
});
