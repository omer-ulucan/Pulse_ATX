import type { IncidentDecision } from "@pulse-atx/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const AnalysisJobSchema = z.object({
  attempts: z.number().int().positive(),
  event_type: z.string(),
  job_id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  raw_event_id: z.uuid(),
  raw_event_revision: z.number().int().positive(),
  source: z.string(),
  source_updated_at: z.string().nullable(),
});

export interface AnalysisJob {
  attempts: number;
  eventType: string;
  id: string;
  payload: Record<string, unknown>;
  rawEventId: string;
  revision: number;
  source: string;
  sourceUpdatedAt: string | null;
}

export interface PersistedAnalysis {
  decision: IncidentDecision;
  inputContext: Record<string, unknown>;
  job: AnalysisJob;
  latencyMs: number;
  modelName: string;
  promptVersion: string;
  usedFallback: boolean;
}

export interface AnalysisRepository {
  claimJobs(workerId: string, limit: number): Promise<AnalysisJob[]>;
  failJob(jobId: string, workerId: string, error: string): Promise<void>;
  persistAnalysis(
    workerId: string,
    analysis: PersistedAnalysis,
  ): Promise<string>;
}

export class SupabaseAnalysisRepository implements AnalysisRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claimJobs(workerId: string, limit: number): Promise<AnalysisJob[]> {
    const response = (await this.client.rpc("claim_event_jobs", {
      p_limit: limit,
      p_worker_id: workerId,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Job claim failed: ${response.error.message}`);
    return z
      .array(AnalysisJobSchema)
      .parse(response.data)
      .map((row) => ({
        attempts: row.attempts,
        eventType: row.event_type,
        id: row.job_id,
        payload: row.payload,
        rawEventId: row.raw_event_id,
        revision: row.raw_event_revision,
        source: row.source,
        sourceUpdatedAt: row.source_updated_at,
      }));
  }

  async failJob(jobId: string, workerId: string, error: string): Promise<void> {
    const response = (await this.client.rpc("fail_event_job", {
      p_error: error,
      p_job_id: jobId,
      p_worker_id: workerId,
    })) as { error: { message: string } | null };
    if (response.error)
      throw new Error(`Job failure write failed: ${response.error.message}`);
  }

  async persistAnalysis(
    workerId: string,
    analysis: PersistedAnalysis,
  ): Promise<string> {
    const response = (await this.client.rpc("persist_analysis_result", {
      p_decision: analysis.decision,
      p_input_context: analysis.inputContext,
      p_job_id: analysis.job.id,
      p_latency_ms: analysis.latencyMs,
      p_model_name: analysis.modelName,
      p_prompt_version: analysis.promptVersion,
      p_used_fallback: analysis.usedFallback,
      p_worker_id: workerId,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Analysis persistence failed: ${response.error.message}`);
    return z.uuid().parse(response.data);
  }
}
