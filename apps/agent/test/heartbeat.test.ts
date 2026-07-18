import { describe, expect, it, vi } from "vitest";

import { MemoryRuntimeRepository } from "../src/repositories/memory-runtime-repository.js";
import { HeartbeatWorker } from "../src/worker/heartbeat-worker.js";
import { SourceScheduler } from "../src/worker/source-scheduler.js";

describe("persistent heartbeat", () => {
  it("polls only due sources and reports queue health", async () => {
    const poll = vi.fn().mockResolvedValue({ changed: 0, received: 1 });
    const repository = new MemoryRuntimeRepository();
    repository.metrics = { activeIncidents: 2, pendingJobs: 3 };
    let now = new Date("2026-07-18T06:00:00.000Z");
    const worker = new HeartbeatWorker(
      repository,
      new SourceScheduler([{ id: "traffic", intervalMs: 10_000, poll }]),
      {
        heartbeatIntervalMs: 5_000,
        staleJobAfterMs: 60_000,
        workerId: "test-worker",
      },
      () => now,
    );

    await worker.heartbeat();
    now = new Date(now.getTime() + 5_000);
    await worker.heartbeat();

    expect(poll).toHaveBeenCalledTimes(1);
    expect(repository.health).toMatchObject({
      activeIncidents: 2,
      pendingJobs: 3,
      status: "healthy",
      workerId: "test-worker",
    });
  });

  it("recovers stale jobs on startup without duplicating source work", async () => {
    const repository = new MemoryRuntimeRepository();
    repository.staleJobs = 2;
    const poll = vi.fn().mockResolvedValue({ changed: 1, received: 1 });
    const worker = new HeartbeatWorker(
      repository,
      new SourceScheduler([{ id: "traffic", intervalMs: 10_000, poll }]),
      {
        heartbeatIntervalMs: 5_000,
        staleJobAfterMs: 60_000,
        workerId: "restart-worker",
      },
      () => new Date("2026-07-18T06:00:00.000Z"),
    );

    await worker.run(true, new AbortController().signal);

    expect(repository.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "startup_recovery" }),
        expect.objectContaining({ eventType: "feed_change" }),
      ]),
    );
    expect(poll).toHaveBeenCalledTimes(1);
    expect(repository.health?.status).toBe("stopping");
  });

  it("isolates source errors and marks health degraded", async () => {
    const repository = new MemoryRuntimeRepository();
    const worker = new HeartbeatWorker(
      repository,
      new SourceScheduler([
        {
          id: "traffic",
          intervalMs: 10_000,
          poll: () => Promise.reject(new Error("feed unavailable")),
        },
      ]),
      {
        heartbeatIntervalMs: 5_000,
        staleJobAfterMs: 60_000,
        workerId: "test-worker",
      },
    );

    await expect(worker.heartbeat()).resolves.toMatchObject({
      pollOutcomes: [expect.objectContaining({ error: "feed unavailable" })],
    });
    expect(repository.health?.status).toBe("degraded");
  });
});
