import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  CrossFeedCorrelationService,
  correlateSignals,
} from "../src/correlation/cross-feed-correlator.js";
import { normalizeCapMetroAlerts } from "../src/feeds/capmetro-alerts.js";
import { normalizeNoaaAlerts } from "../src/feeds/noaa-alerts.js";
import type { ChatModel } from "../src/models/types.js";
import { MemoryAnalysisRepository } from "../src/repositories/memory-analysis-repository.js";
import { AnalysisProcessor } from "../src/services/analysis-processor.js";
import { NemotronAnalyzer } from "../src/services/nemotron-analyzer.js";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

class CountingModel implements ChatModel {
  calls = 0;
  readonly modelName = "nemotron-cross-feed-mock";

  complete(): Promise<string> {
    this.calls += 1;
    return Promise.resolve("{}");
  }
}

const trafficCandidate = {
  incidentId: "10000000-0000-4000-8000-000000000006",
  predictedDurationMinutes: 30,
  severity: 3,
  signal: {
    durationDeltaMinutes: 0,
    eventType: "traffic_incident",
    latitude: 30.2884,
    locationName: "N LAMAR BLVD / W 24TH ST",
    longitude: -97.7417,
    occurredAt: "2026-07-18T18:30:00.000Z",
    routeIds: ["801"],
    severity: 3,
    source: "austin_traffic" as const,
    summary: "Two lanes blocked on North Lamar",
  },
};

describe("cross-feed intelligence", () => {
  it("normalizes a NOAA GeoJSON alert with a spatial center", async () => {
    const [alert] = normalizeNoaaAlerts(await loadFixture("noaa-alerts.json"));
    expect(alert).toMatchObject({
      eventType: "weather_alert",
      externalId: "https://api.weather.gov/alerts/fixture-austin-flash-flood",
      locationName: "Travis County",
      source: "noaa_weather",
    });
    expect(alert?.latitude).toBeCloseTo(30.276, 2);
    expect(alert?.longitude).toBeCloseTo(-97.754, 2);
    expect(alert?.payload).toMatchObject({ severity_score: 4 });
  });

  it("derives a significant-delay anomaly from CapMetro GTFS-Realtime", async () => {
    const [alert] = normalizeCapMetroAlerts(
      await loadFixture("capmetro-alerts.json"),
    );
    expect(alert).toMatchObject({
      eventType: "transit_disruption",
      externalId: "capmetro-fixture-alert-801",
      locationName: "CapMetro routes 801",
      source: "capmetro",
    });
    expect(alert?.payload).toMatchObject({
      route_ids: ["801"],
      severity_score: 4,
      transit_delay_minutes: 45,
    });
  });

  it("correlates spatially and temporally, then escalates impact", async () => {
    const [weather] = normalizeNoaaAlerts(
      await loadFixture("noaa-alerts.json"),
    );
    expect(weather).toBeDefined();
    const decision = correlateSignals(
      {
        durationDeltaMinutes: 0,
        eventType: weather?.eventType ?? "weather_alert",
        latitude: weather?.latitude ?? null,
        locationName: weather?.locationName ?? null,
        longitude: weather?.longitude ?? null,
        occurredAt: weather?.sourceUpdatedAt ?? "",
        routeIds: [],
        severity: 4,
        source: "noaa_weather",
        summary: weather?.summary ?? "",
      },
      [trafficCandidate],
    );
    expect(decision).toMatchObject({
      candidateIncidentId: trafficCandidate.incidentId,
      durationMinutes: 60,
      severity: 4,
    });
    expect(decision?.score).toBeGreaterThanOrEqual(0.5);
  });

  it("attaches a supporting feed without creating a duplicate incident", async () => {
    const repository = new MemoryAnalysisRepository();
    repository.correlationCandidates.push(trafficCandidate);
    const job = repository.addJob(
      {
        areaDesc: "Travis County",
        headline: "Flash Flood Warning for central Austin",
        latitude: 30.286,
        longitude: -97.744,
        sent: "2026-07-18T18:40:00.000Z",
        severity_score: 4,
      },
      "weather_alert",
    );
    job.source = "noaa_weather";
    const model = new CountingModel();

    const summary = await new AnalysisProcessor(
      repository,
      new NemotronAnalyzer(model),
      "correlation-worker",
      8,
      4,
      undefined,
      undefined,
      new CrossFeedCorrelationService(repository),
    ).processBatch();

    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(repository.correlations).toHaveLength(1);
    expect(repository.persisted).toHaveLength(0);
    expect(model.calls).toBe(0);
  });
});
