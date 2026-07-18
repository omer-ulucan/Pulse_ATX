import { EventSourceSchema, type IncidentDecision } from "@pulse-atx/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  CorrelationCandidate,
  CorrelationDecision,
  CrossFeedRepository,
} from "../correlation/types.js";
import type { SecurityScanResult } from "../security/types.js";

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

export interface AnalysisRepository extends CrossFeedRepository {
  claimJobs(workerId: string, limit: number): Promise<AnalysisJob[]>;
  failJob(jobId: string, workerId: string, error: string): Promise<void>;
  persistAnalysis(
    workerId: string,
    analysis: PersistedAnalysis,
  ): Promise<string>;
  quarantineJob(
    workerId: string,
    job: AnalysisJob,
    finding: SecurityScanResult,
  ): Promise<string>;
}

const CorrelationCandidateRowSchema = z.object({
  event_type: z.string(),
  incident_id: z.uuid(),
  latitude: z.number().nullable(),
  location_name: z.string().nullable(),
  longitude: z.number().nullable(),
  occurred_at: z.string(),
  payload: z.record(z.string(), z.unknown()),
  predicted_duration_minutes: z.number().int().nonnegative().nullable(),
  severity: z.number().int().min(1).max(5).nullable(),
  source: z.string(),
  summary: z.string(),
});

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

  async listCorrelationCandidates(
    rawEventId: string,
  ): Promise<CorrelationCandidate[]> {
    const response = (await this.client.rpc("list_cross_feed_candidates", {
      p_raw_event_id: rawEventId,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(
        `Correlation candidate lookup failed: ${response.error.message}`,
      );
    return z
      .array(CorrelationCandidateRowSchema)
      .parse(response.data)
      .map((row) => ({
        incidentId: row.incident_id,
        predictedDurationMinutes: row.predicted_duration_minutes ?? 0,
        severity: row.severity ?? 1,
        signal: {
          durationDeltaMinutes:
            typeof row.payload.transit_delay_minutes === "number"
              ? row.payload.transit_delay_minutes
              : 0,
          eventType: row.event_type,
          latitude: row.latitude,
          locationName: row.location_name,
          longitude: row.longitude,
          occurredAt: row.occurred_at,
          routeIds: Array.isArray(row.payload.route_ids)
            ? row.payload.route_ids.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
          severity:
            typeof row.payload.severity_score === "number"
              ? row.payload.severity_score
              : (row.severity ?? 1),
          source: EventSourceSchema.parse(row.source),
          summary: row.summary,
        },
      }));
  }

  async persistCorrelation(
    workerId: string,
    job: AnalysisJob,
    decision: CorrelationDecision,
  ): Promise<string> {
    const response = (await this.client.rpc("apply_cross_feed_correlation", {
      p_decision: decision,
      p_incident_id: decision.candidateIncidentId,
      p_job_id: job.id,
      p_worker_id: workerId,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(
        `Correlation persistence failed: ${response.error.message}`,
      );
    return z.uuid().parse(response.data);
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

  async quarantineJob(
    workerId: string,
    job: AnalysisJob,
    finding: SecurityScanResult,
  ): Promise<string> {
    const primaryDetection = finding.detections[0];
    const response = (await this.client.rpc("quarantine_event_job", {
      p_action_taken: "quarantined",
      p_details: {
        ...finding.details,
        detections: finding.detections,
        providerEventId: finding.eventId,
      },
      p_job_id: job.id,
      p_provider: finding.provider,
      p_severity: primaryDetection?.severity ?? "high",
      p_stage: finding.stage,
      p_threat_type: primaryDetection?.category ?? "runtime_security_detection",
      p_worker_id: workerId,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Quarantine write failed: ${response.error.message}`);
    return z.uuid().parse(response.data);
  }
}
