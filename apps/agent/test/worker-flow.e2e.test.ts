import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { normalizeAustinTrafficFeed } from "../src/feeds/austin-traffic.js";
import type { FeedAdapter } from "../src/feeds/types.js";
import type { ChatModel } from "../src/models/types.js";
import { MemoryAnalysisRepository } from "../src/repositories/memory-analysis-repository.js";
import { MemoryEventRepository } from "../src/repositories/memory-event-repository.js";
import { MemoryRuntimeRepository } from "../src/repositories/memory-runtime-repository.js";
import { DeterministicSecurityScanner } from "../src/security/deterministic-scanner.js";
import { AnalysisProcessor } from "../src/services/analysis-processor.js";
import { IngestionService } from "../src/services/ingestion-service.js";
import { NemotronAnalyzer } from "../src/services/nemotron-analyzer.js";
import { HeartbeatWorker } from "../src/worker/heartbeat-worker.js";
import { SourceScheduler } from "../src/worker/source-scheduler.js";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

class PipelineEventRepository extends MemoryEventRepository {
  constructor(private readonly analysis: MemoryAnalysisRepository) {
    super();
  }

  override async ingestEvent(
    event: Parameters<MemoryEventRepository["ingestEvent"]>[0],
  ) {
    const result = await super.ingestEvent(event);
    if (result.changed) {
      const job = this.analysis.addJob(event.payload, event.eventType);
      job.source = event.source;
      job.sourceUpdatedAt = event.sourceUpdatedAt;
    }
    return result;
  }
}

class PipelineRuntimeRepository extends MemoryRuntimeRepository {
  constructor(private readonly analysis: MemoryAnalysisRepository) {
    super();
  }

  override getQueueMetrics() {
    return Promise.resolve({
      activeIncidents: this.analysis.persisted.length,
      pendingJobs: this.analysis.jobs.filter((job) => job.status === "pending")
        .length,
    });
  }
}

class FixtureNemotron implements ChatModel {
  readonly modelName = "nemotron-fixture-contract";

  complete(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        affected_entities: [{ name: "North Lamar Boulevard", type: "road" }],
        confidence: 0.87,
        evidence: ["Austin traffic feed reports a lane-blocking collision"],
        incident_type: "traffic_incident",
        memory_effect: {
          adjusted_prediction_minutes: 38,
          base_prediction_minutes: 38,
          similar_incident_count: 0,
          used_historical_memory: false,
        },
        predicted_duration_minutes: 38,
        recommended_actions: ["Monitor lane clearance"],
        requires_human_approval: true,
        severity: 4,
        summary: "A collision is blocking lanes on North Lamar Boulevard.",
        title: "North Lamar lane-blocking collision",
      }),
    );
  }
}

describe("end-to-end persistent worker flow", () => {
  it("ingests fixtures, analyzes safe data, quarantines an attack, and updates health", async () => {
    const events = normalizeAustinTrafficFeed([
      ...((await loadFixture("austin-traffic.json")) as unknown[]),
      ...((await loadFixture("austin-traffic-malicious.json")) as unknown[]),
    ]);
    const adapter: FeedAdapter = {
      source: "austin_traffic",
      poll: () =>
        Promise.resolve({
          etag: "fixture-e2e-v1",
          events,
          lastModified: "Sat, 18 Jul 2026 05:34:00 GMT",
          notModified: false,
        }),
    };
    const analysisRepository = new MemoryAnalysisRepository();
    const eventRepository = new PipelineEventRepository(analysisRepository);
    const ingestion = new IngestionService(adapter, eventRepository);
    const security = new DeterministicSecurityScanner();
    const processor = new AnalysisProcessor(
      analysisRepository,
      new NemotronAnalyzer(new FixtureNemotron(), undefined, security),
      "e2e-worker",
      8,
      2,
      security,
    );
    const runtimeRepository = new PipelineRuntimeRepository(analysisRepository);
    const worker = new HeartbeatWorker(
      runtimeRepository,
      new SourceScheduler([
        {
          id: "austin_traffic",
          intervalMs: 10_000,
          poll: (signal) => ingestion.poll(signal),
        },
      ]),
      {
        heartbeatIntervalMs: 5_000,
        staleJobAfterMs: 60_000,
        workerId: "e2e-worker",
      },
      () => new Date("2026-07-18T06:00:00.000Z"),
      () => undefined,
      processor,
    );

    const summary = await worker.heartbeat();

    expect(eventRepository.events).toHaveLength(2);
    expect(summary.processing).toMatchObject({
      claimed: 2,
      completed: 1,
      failed: 0,
      quarantined: 1,
    });
    expect(analysisRepository.persisted).toHaveLength(1);
    expect(analysisRepository.quarantined[0]?.finding.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "prompt_injection" }),
        expect.objectContaining({ category: "data_exfiltration" }),
      ]),
    );
    expect(runtimeRepository.health).toMatchObject({
      activeIncidents: 1,
      pendingJobs: 0,
      status: "healthy",
      workerId: "e2e-worker",
    });
    expect(runtimeRepository.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "feed_change" }),
      ]),
    );
  });
});
