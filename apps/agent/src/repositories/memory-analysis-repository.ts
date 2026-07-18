import { randomUUID } from "node:crypto";

import type { SecurityScanResult } from "../security/types.js";
import type {
  CorrelationCandidate,
  CorrelationDecision,
} from "../correlation/types.js";

import type {
  AnalysisJob,
  AnalysisRepository,
  PersistedAnalysis,
} from "./analysis-repository.js";

interface MemoryQueuedJob extends AnalysisJob {
  status: "completed" | "failed" | "pending" | "processing" | "quarantined";
}

export class MemoryAnalysisRepository implements AnalysisRepository {
  readonly correlationCandidates: CorrelationCandidate[] = [];
  readonly correlations: CorrelationDecision[] = [];
  readonly jobs: MemoryQueuedJob[] = [];
  readonly persisted: (PersistedAnalysis & { incidentId: string })[] = [];
  readonly quarantined: { finding: SecurityScanResult; job: AnalysisJob }[] =
    [];

  addJob(
    payload: Record<string, unknown>,
    eventType = "traffic_incident",
  ): AnalysisJob {
    const job: MemoryQueuedJob = {
      attempts: 0,
      eventType,
      id: randomUUID(),
      payload,
      rawEventId: randomUUID(),
      revision: 1,
      source: "fixture",
      sourceUpdatedAt: null,
      status: "pending",
    };
    this.jobs.push(job);
    return job;
  }

  claimJobs(_workerId: string, limit: number): Promise<AnalysisJob[]> {
    const claimed = this.jobs
      .filter((job) => job.status === "pending")
      .slice(0, limit);
    for (const job of claimed) {
      job.status = "processing";
      job.attempts += 1;
    }
    return Promise.resolve(claimed);
  }

  listCorrelationCandidates(
    rawEventId: string,
  ): Promise<CorrelationCandidate[]> {
    void rawEventId;
    return Promise.resolve(this.correlationCandidates);
  }

  persistCorrelation(
    _workerId: string,
    job: AnalysisJob,
    decision: CorrelationDecision,
  ): Promise<string> {
    const stored = this.jobs.find((item) => item.id === job.id);
    if (!stored || stored.status !== "processing")
      return Promise.reject(new Error("Job was not claimed"));
    stored.status = "completed";
    this.correlations.push(decision);
    return Promise.resolve(decision.candidateIncidentId);
  }

  failJob(jobId: string, workerId: string, error: string): Promise<void> {
    void workerId;
    void error;
    const job = this.jobs.find((item) => item.id === jobId);
    if (job) job.status = job.attempts >= 3 ? "failed" : "pending";
    return Promise.resolve();
  }

  persistAnalysis(
    _workerId: string,
    analysis: PersistedAnalysis,
  ): Promise<string> {
    const job = this.jobs.find((item) => item.id === analysis.job.id);
    if (!job || job.status !== "processing") {
      return Promise.reject(new Error("Job was not claimed"));
    }
    job.status = "completed";
    const incidentId = randomUUID();
    this.persisted.push({ ...analysis, incidentId });
    return Promise.resolve(incidentId);
  }

  quarantineJob(
    workerId: string,
    job: AnalysisJob,
    finding: SecurityScanResult,
  ): Promise<string> {
    void workerId;
    const stored = this.jobs.find((item) => item.id === job.id);
    if (stored) stored.status = "quarantined";
    this.quarantined.push({ finding, job });
    return Promise.resolve(randomUUID());
  }
}
