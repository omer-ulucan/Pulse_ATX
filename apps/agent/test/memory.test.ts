import { evaluateLearning } from "@pulse-atx/shared";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { normalizeAustinTrafficFeed } from "../src/feeds/austin-traffic.js";
import {
  EmbeddingClient,
  type EmbeddingProvider,
} from "../src/memory/embedding-client.js";
import type { CompletedIncident } from "../src/memory/learning-repository.js";
import { LessonExtractor } from "../src/memory/lesson-extractor.js";
import { MemoryLearningRepository } from "../src/memory/memory-learning-repository.js";
import { MemoryService } from "../src/memory/memory-service.js";
import type { ChatModel } from "../src/models/types.js";
import { MemoryAnalysisRepository } from "../src/repositories/memory-analysis-repository.js";
import { AnalysisProcessor } from "../src/services/analysis-processor.js";
import { NemotronAnalyzer } from "../src/services/nemotron-analyzer.js";

async function loadFixture(name: string): Promise<unknown> {
  const text = await readFile(
    new URL(`./fixtures/${name}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(text) as unknown;
}

async function loadCompletedIncidentFixture(): Promise<CompletedIncident> {
  return (await loadFixture("completed-incident.json")) as CompletedIncident;
}

class FixedEmbedding implements EmbeddingProvider {
  embed(): Promise<number[]> {
    return Promise.resolve([1, ...Array<number>(383).fill(0)]);
  }
}

class LessonModel implements ChatModel {
  readonly modelName = "nemotron-lesson-mock";

  complete(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        adjustment_minutes: 18,
        conditions: {
          event_type: "traffic_incident",
          location_characteristics: ["arterial road", "two blocked lanes"],
          time_bucket: "morning",
          weather: "heavy rain",
        },
        lesson:
          "Heavy rain and two blocked lanes extended clearance by about 18 minutes.",
        recommended_action:
          "Increase the initial duration estimate during heavy rain.",
      }),
    );
  }
}

class AdaptiveAnalysisModel implements ChatModel {
  readonly modelName = "nemotron-memory-mock";

  complete(_systemPrompt: string, userPrompt: string): Promise<string> {
    const usedMemory = userPrompt.includes(
      "extended clearance by about 18 minutes",
    );
    const duration = usedMemory ? 38 : 22;
    return Promise.resolve(
      JSON.stringify({
        affected_entities: [{ name: "North Lamar Boulevard", type: "road" }],
        confidence: usedMemory ? 0.88 : 0.68,
        evidence: ["Two lanes blocked on North Lamar"],
        incident_type: "traffic_incident",
        memory_effect: {
          adjusted_prediction_minutes: duration,
          base_prediction_minutes: 22,
          similar_incident_count: usedMemory ? 1 : 0,
          used_historical_memory: usedMemory,
        },
        predicted_duration_minutes: duration,
        recommended_actions: ["Monitor lane clearance"],
        requires_human_approval: false,
        severity: 4,
        summary: "A two-lane collision is disrupting North Lamar.",
        title: "North Lamar lane-blocking collision",
      }),
    );
  }
}

describe("recursive incident memory", () => {
  it("calls an OpenAI-compatible 384-dimensional embedding endpoint", async () => {
    let requestUrl = "";
    const fetcher: typeof fetch = (input) => {
      requestUrl =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: Array<number>(384).fill(0.1), index: 0 }],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    };
    const client = new EmbeddingClient(
      { baseUrl: "http://embeddings.test/v1", modelName: "bge-small" },
      fetcher,
    );

    await expect(client.embed("Austin collision")).resolves.toHaveLength(384);
    expect(requestUrl).toBe("http://embeddings.test/v1/embeddings");
  });

  it("creates and retrieves a memory for a completed incident", async () => {
    const repository = new MemoryLearningRepository();
    repository.candidates.push(await loadCompletedIncidentFixture());
    const service = new MemoryService(
      new FixedEmbedding(),
      repository,
      new LessonExtractor(new LessonModel()),
    );

    await expect(service.consolidateCompleted()).resolves.toBe(1);
    expect(repository.memories).toHaveLength(1);
    const [similarEvent] = normalizeAustinTrafficFeed(
      await loadFixture("austin-traffic.json"),
    );
    expect(similarEvent).toBeDefined();
    const matches = await service.retrieveForEvent({
      address: similarEvent?.locationName,
      event_type: similarEvent?.eventType,
      latitude: similarEvent?.latitude,
      longitude: similarEvent?.longitude,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.lesson).toMatchObject({ adjustment_minutes: 18 });
  });

  it("changes a future prediction after retrieving a historical lesson", async () => {
    const learningRepository = new MemoryLearningRepository();
    const memory = new MemoryService(
      new FixedEmbedding(),
      learningRepository,
      new LessonExtractor(new LessonModel()),
    );
    const model = new AdaptiveAnalysisModel();
    const [similarEvent] = normalizeAustinTrafficFeed(
      await loadFixture("austin-traffic.json"),
    );
    expect(similarEvent).toBeDefined();

    const beforeRepository = new MemoryAnalysisRepository();
    beforeRepository.addJob(similarEvent?.payload ?? {});
    await new AnalysisProcessor(
      beforeRepository,
      new NemotronAnalyzer(model),
      "memory-worker",
      8,
      4,
      undefined,
      memory,
    ).processBatch();

    learningRepository.candidates.push(await loadCompletedIncidentFixture());
    await memory.consolidateCompleted();
    const afterRepository = new MemoryAnalysisRepository();
    afterRepository.addJob(similarEvent?.payload ?? {});
    await new AnalysisProcessor(
      afterRepository,
      new NemotronAnalyzer(model),
      "memory-worker",
      8,
      4,
      undefined,
      memory,
    ).processBatch();

    expect(
      beforeRepository.persisted[0]?.decision.predicted_duration_minutes,
    ).toBe(22);
    expect(
      afterRepository.persisted[0]?.decision.predicted_duration_minutes,
    ).toBe(38);
    expect(afterRepository.persisted[0]?.decision.memory_effect).toMatchObject({
      similar_incident_count: 1,
      used_historical_memory: true,
    });
  });

  it("reports improved before-and-after duration MAE", () => {
    expect(
      evaluateLearning([
        { actual: 42, predictedWithMemory: 39, predictedWithoutMemory: 24 },
        { actual: 51, predictedWithMemory: 47, predictedWithoutMemory: 28 },
        { actual: 36, predictedWithMemory: 34, predictedWithoutMemory: 20 },
      ]),
    ).toEqual({
      improvementPercent: 84.21,
      sampleCount: 3,
      withMemoryMae: 3,
      withoutMemoryMae: 19,
    });
  });
});
