import { sleep } from "@pulse-atx/shared";

import type { RuntimeRepository } from "../repositories/runtime-repository.js";
import type { AnalysisBatchSummary } from "../services/analysis-processor.js";
import type { MissionBatchSummary } from "../commander/mission-lifecycle.js";
import type { SourcePollOutcome, SourceScheduler } from "./source-scheduler.js";

export interface HeartbeatOptions {
  heartbeatIntervalMs: number;
  staleJobAfterMs: number;
  workerId: string;
}

export interface HeartbeatSummary {
  activeIncidents: number;
  memoriesCreated: number;
  missions: MissionBatchSummary | null;
  pendingJobs: number;
  pollOutcomes: SourcePollOutcome[];
  processing: AnalysisBatchSummary | null;
  recoveredJobs: number;
}

export interface JobBatchProcessor {
  processBatch(signal?: AbortSignal): Promise<AnalysisBatchSummary>;
}

export interface MemoryConsolidator {
  consolidateCompleted(limit?: number, signal?: AbortSignal): Promise<number>;
}

export interface MissionBatchProcessor {
  processBatch(signal?: AbortSignal): Promise<MissionBatchSummary>;
}

export class HeartbeatWorker {
  constructor(
    private readonly repository: RuntimeRepository,
    private readonly scheduler: SourceScheduler,
    private readonly options: HeartbeatOptions,
    private readonly now: () => Date = () => new Date(),
    private readonly onHeartbeat: (summary: HeartbeatSummary) => void = () =>
      undefined,
    private readonly jobProcessor?: JobBatchProcessor,
    private readonly memoryConsolidator?: MemoryConsolidator,
    private readonly missionProcessor?: MissionBatchProcessor,
  ) {}

  private async updateStatus(
    status: "degraded" | "healthy" | "starting" | "stopping",
    summary: Partial<HeartbeatSummary> = {},
  ): Promise<void> {
    await this.repository.updateAgentHealth({
      activeIncidents: summary.activeIncidents ?? 0,
      heartbeatIntervalSeconds: Math.ceil(
        this.options.heartbeatIntervalMs / 1_000,
      ),
      lastHeartbeatAt: this.now().toISOString(),
      metadata: {
        memoriesCreated: summary.memoriesCreated ?? 0,
        missions: summary.missions ?? null,
        pollOutcomes: summary.pollOutcomes ?? [],
        processing: summary.processing ?? null,
        recoveredJobs: summary.recoveredJobs ?? 0,
      },
      pendingJobs: summary.pendingJobs ?? 0,
      status,
      workerId: this.options.workerId,
    });
  }

  async heartbeat(signal?: AbortSignal): Promise<HeartbeatSummary> {
    const current = this.now();
    const recoveredJobs = await this.repository.recoverStaleJobs(
      new Date(current.getTime() - this.options.staleJobAfterMs).toISOString(),
    );
    const pollOutcomes = await this.scheduler.pollDue(
      current.getTime(),
      signal,
    );
    const processing = this.jobProcessor
      ? await this.jobProcessor.processBatch(signal)
      : null;
    const missions = this.missionProcessor
      ? await this.missionProcessor.processBatch(signal)
      : null;
    const memoriesCreated = this.memoryConsolidator
      ? await this.memoryConsolidator.consolidateCompleted(2, signal)
      : 0;
    const metrics = await this.repository.getQueueMetrics();
    const degraded = pollOutcomes.some((outcome) => outcome.error !== null);
    const summary = {
      ...metrics,
      memoriesCreated,
      missions,
      pollOutcomes,
      processing,
      recoveredJobs,
    };
    await this.updateStatus(degraded ? "degraded" : "healthy", summary);
    if (recoveredJobs > 0) {
      await this.repository.appendTimeline(
        "startup_recovery",
        `Recovered ${recoveredJobs} stale processing job${recoveredJobs === 1 ? "" : "s"}`,
        { recoveredJobs },
      );
    }
    for (const outcome of pollOutcomes.filter((item) => item.changed > 0)) {
      await this.repository.appendTimeline(
        "feed_change",
        `${outcome.id} detected ${outcome.changed} changed event${outcome.changed === 1 ? "" : "s"}`,
        { ...outcome },
      );
    }
    this.onHeartbeat(summary);
    return summary;
  }

  async run(once: boolean, signal: AbortSignal): Promise<void> {
    await this.updateStatus("starting");
    await this.repository.appendTimeline(
      "worker_started",
      "Persistent agent worker started",
      {
        workerId: this.options.workerId,
      },
    );
    try {
      do {
        try {
          await this.heartbeat(signal);
        } catch (error) {
          await this.updateStatus("degraded");
          await this.repository.appendTimeline(
            "heartbeat_error",
            error instanceof Error ? error.message : "Heartbeat failed",
          );
        }
        if (!once && !signal.aborted) {
          await sleep(this.options.heartbeatIntervalMs, signal);
        }
      } while (!once && !signal.aborted);
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      await this.updateStatus("stopping");
      await this.repository.appendTimeline(
        "worker_stopped",
        "Agent worker stopped",
        {
          workerId: this.options.workerId,
        },
      );
    }
  }
}
