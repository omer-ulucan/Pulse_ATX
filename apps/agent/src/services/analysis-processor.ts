import { mapBounded } from "@pulse-atx/shared";

import type { InferenceMetricsSnapshot } from "../models/types.js";
import type { AnalysisRepository } from "../repositories/analysis-repository.js";
import {
  enforceSecurityScan,
  SecurityBlockError,
  type SecurityScanner,
} from "../security/types.js";
import type { NemotronAnalyzer } from "./nemotron-analyzer.js";

export interface AnalysisBatchSummary {
  claimed: number;
  completed: number;
  failed: number;
  inference: InferenceMetricsSnapshot;
  quarantined: number;
}

export interface AnalysisMemoryProvider {
  retrieveForEvent(
    event: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]>;
}

export class AnalysisProcessor {
  constructor(
    private readonly repository: AnalysisRepository,
    private readonly analyzer: NemotronAnalyzer,
    private readonly workerId: string,
    private readonly maxBatchSize = 8,
    private readonly concurrency = 4,
    private readonly security?: SecurityScanner,
    private readonly memory?: AnalysisMemoryProvider,
  ) {}

  async processBatch(signal?: AbortSignal): Promise<AnalysisBatchSummary> {
    const jobs = await this.repository.claimJobs(
      this.workerId,
      this.maxBatchSize,
    );
    const outcomes = await mapBounded(jobs, this.concurrency, async (job) => {
      try {
        await enforceSecurityScan(
          this.security,
          "feed_input",
          JSON.stringify(job.payload),
          { rawEventId: job.rawEventId, source: job.source },
          signal,
        );
        const event = {
          ...job.payload,
          event_type: job.eventType,
          source: job.source,
          source_updated_at: job.sourceUpdatedAt,
        };
        const retrievedMemories = this.memory
          ? await this.memory.retrieveForEvent(event, signal)
          : [];
        const result = await this.analyzer.analyze(
          {
            event,
            retrievedMemories,
          },
          signal,
        );
        await this.repository.persistAnalysis(this.workerId, {
          ...result,
          job,
        });
        return "completed" as const;
      } catch (error) {
        if (error instanceof SecurityBlockError) {
          await this.repository.quarantineJob(
            this.workerId,
            job,
            error.finding,
          );
          return "quarantined" as const;
        }
        await this.repository.failJob(
          job.id,
          this.workerId,
          error instanceof Error ? error.message : "Event analysis failed",
        );
        return "failed" as const;
      }
    });
    const completed = outcomes.filter(
      (outcome) => outcome === "completed",
    ).length;
    const quarantined = outcomes.filter(
      (outcome) => outcome === "quarantined",
    ).length;
    return {
      claimed: jobs.length,
      completed,
      failed: jobs.length - completed - quarantined,
      inference: this.analyzer.metrics.snapshot(),
      quarantined,
    };
  }
}
