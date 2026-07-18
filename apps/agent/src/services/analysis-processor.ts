import { mapBounded } from "@pulse-atx/shared";

import type { InferenceMetricsSnapshot } from "../models/types.js";
import type { AnalysisRepository } from "../repositories/analysis-repository.js";
import type { NemotronAnalyzer } from "./nemotron-analyzer.js";

export interface AnalysisBatchSummary {
  claimed: number;
  completed: number;
  failed: number;
  inference: InferenceMetricsSnapshot;
}

export class AnalysisProcessor {
  constructor(
    private readonly repository: AnalysisRepository,
    private readonly analyzer: NemotronAnalyzer,
    private readonly workerId: string,
    private readonly maxBatchSize = 8,
    private readonly concurrency = 4,
  ) {}

  async processBatch(signal?: AbortSignal): Promise<AnalysisBatchSummary> {
    const jobs = await this.repository.claimJobs(
      this.workerId,
      this.maxBatchSize,
    );
    const outcomes = await mapBounded(jobs, this.concurrency, async (job) => {
      try {
        const result = await this.analyzer.analyze(
          {
            event: {
              ...job.payload,
              event_type: job.eventType,
              source: job.source,
              source_updated_at: job.sourceUpdatedAt,
            },
          },
          signal,
        );
        await this.repository.persistAnalysis(this.workerId, {
          ...result,
          job,
        });
        return true;
      } catch (error) {
        await this.repository.failJob(
          job.id,
          this.workerId,
          error instanceof Error ? error.message : "Event analysis failed",
        );
        return false;
      }
    });
    const completed = outcomes.filter(Boolean).length;
    return {
      claimed: jobs.length,
      completed,
      failed: jobs.length - completed,
      inference: this.analyzer.metrics.snapshot(),
    };
  }
}
