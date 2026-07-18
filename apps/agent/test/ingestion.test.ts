import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { normalizeAustinTrafficFeed } from "../src/feeds/austin-traffic.js";
import type { FeedAdapter } from "../src/feeds/types.js";
import { MemoryEventRepository } from "../src/repositories/memory-event-repository.js";
import { IngestionService } from "../src/services/ingestion-service.js";

async function loadFixture(name: string): Promise<unknown> {
  const text = await readFile(
    new URL(`./fixtures/${name}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(text) as unknown;
}

describe("Austin traffic ingestion", () => {
  it("normalizes a realistic Austin traffic fixture", async () => {
    const [event] = normalizeAustinTrafficFeed(
      await loadFixture("austin-traffic.json"),
    );

    expect(event).toMatchObject({
      eventType: "traffic_incident",
      externalId: "AUS-2026-0718-001",
      latitude: 30.2884,
      locationName: "N LAMAR BLVD / W 24TH ST",
      longitude: -97.7417,
      source: "austin_traffic",
      status: "ACTIVE",
    });
    expect(event?.fingerprint).toHaveLength(64);
  });

  it("rejects records without a stable source identifier", () => {
    expect(() =>
      normalizeAustinTrafficFeed([
        {
          address: "N LAMAR BLVD / W 24TH ST",
          issue_reported: "COLLISION",
          latitude: 30.2884,
          longitude: -97.7417,
        },
      ]),
    ).toThrow("missing a stable source identifier");
  });

  it("ignores duplicates and creates a job for each changed revision", async () => {
    const initial = normalizeAustinTrafficFeed(
      await loadFixture("austin-traffic.json"),
    );
    const changed = normalizeAustinTrafficFeed(
      await loadFixture("austin-traffic-changed.json"),
    );
    const responses = [initial, initial, changed];
    let pollIndex = 0;
    const adapter: FeedAdapter = {
      source: "austin_traffic",
      poll: () =>
        Promise.resolve({
          etag: `fixture-${pollIndex}`,
          events: responses[pollIndex++] ?? [],
          lastModified: null,
          notModified: false,
        }),
    };
    const repository = new MemoryEventRepository();
    const service = new IngestionService(adapter, repository);

    await expect(service.poll()).resolves.toEqual({ changed: 1, received: 1 });
    await expect(service.poll()).resolves.toEqual({ changed: 0, received: 1 });
    await expect(service.poll()).resolves.toEqual({ changed: 1, received: 1 });

    expect(repository.events).toHaveLength(1);
    expect(repository.jobs.map((job) => job.revision)).toEqual([1, 2]);
    expect(repository.sourceHealth.get("austin_traffic")).toMatchObject({
      itemsChanged: 1,
      itemsReceived: 1,
      status: "healthy",
    });
  });

  it("records degraded source health for invalid feed data", async () => {
    const repository = new MemoryEventRepository();
    const adapter: FeedAdapter = {
      source: "austin_traffic",
      poll: () => Promise.reject(new Error("fixture timeout")),
    };
    const service = new IngestionService(adapter, repository);

    await expect(service.poll()).rejects.toThrow("fixture timeout");
    expect(repository.sourceHealth.get("austin_traffic")).toMatchObject({
      lastError: "fixture timeout",
      status: "degraded",
    });
  });
});
