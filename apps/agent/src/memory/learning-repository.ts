import type { IncidentLesson } from "@pulse-atx/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const IncidentSchema = z.object({
  actual_duration_minutes: z.number().int().nonnegative(),
  id: z.uuid(),
  incident_type: z.string(),
  latitude: z.number().nullable(),
  location_name: z.string().nullable(),
  longitude: z.number().nullable(),
  predicted_duration_minutes: z.number().int().nonnegative(),
  severity: z.number().int().nullable(),
  started_at: z.string().nullable(),
  summary: z.string(),
  title: z.string(),
});

const OutcomeSchema = z.object({
  actual_duration_minutes: z.number().int().nonnegative(),
  observed_severity: z.number().int().nullable(),
  outcome: z.record(z.string(), z.unknown()),
  prediction_error: z.number().nonnegative(),
});

const CandidateSchema = z.object({
  incident: IncidentSchema,
  outcome: OutcomeSchema,
});
const MemoryMatchSchema = z.object({
  combined_score: z.number(),
  incident_id: z.uuid(),
  lesson: z.record(z.string(), z.unknown()),
  memory_id: z.uuid(),
  similarity: z.number(),
  summary: z.string(),
});

export type CompletedIncident = z.infer<typeof CandidateSchema>;

export interface MemoryMatch {
  combinedScore: number;
  incidentId: string;
  lesson: Record<string, unknown>;
  memoryId: string;
  similarity: number;
  summary: string;
}

export interface MemoryQuery {
  embedding: number[];
  incidentType: string | null;
  latitude: number | null;
  longitude: number | null;
  timeBucket: string | null;
}

export interface StoredMemory {
  embedding: number[];
  incidentId: string;
  lesson: IncidentLesson;
  qualityScore: number;
  summary: string;
}

export interface LearningRepository {
  listMemoryCandidates(limit: number): Promise<CompletedIncident[]>;
  recordOutcome(
    incidentId: string,
    actualDurationMinutes: number,
    observedSeverity: number,
    outcome: Record<string, unknown>,
  ): Promise<string>;
  retrieveSimilar(query: MemoryQuery, limit: number): Promise<MemoryMatch[]>;
  storeMemory(memory: StoredMemory): Promise<string>;
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class SupabaseLearningRepository implements LearningRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listMemoryCandidates(limit: number): Promise<CompletedIncident[]> {
    const response = (await this.client.rpc("list_memory_candidates", {
      p_limit: limit,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(
        `Memory candidate query failed: ${response.error.message}`,
      );
    return z.array(CandidateSchema).parse(response.data);
  }

  async recordOutcome(
    incidentId: string,
    actualDurationMinutes: number,
    observedSeverity: number,
    outcome: Record<string, unknown>,
  ): Promise<string> {
    const response = (await this.client.rpc("record_incident_outcome", {
      p_actual_duration_minutes: actualDurationMinutes,
      p_incident_id: incidentId,
      p_observed_severity: observedSeverity,
      p_outcome: outcome,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Outcome write failed: ${response.error.message}`);
    return z.uuid().parse(response.data);
  }

  async retrieveSimilar(
    query: MemoryQuery,
    limit: number,
  ): Promise<MemoryMatch[]> {
    const response = (await this.client.rpc("match_incident_memories", {
      p_incident_type: query.incidentType,
      p_latitude: query.latitude,
      p_limit: limit,
      p_longitude: query.longitude,
      p_query_embedding: vectorLiteral(query.embedding),
      p_time_bucket: query.timeBucket,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Memory retrieval failed: ${response.error.message}`);
    return z
      .array(MemoryMatchSchema)
      .parse(response.data)
      .map((row) => ({
        combinedScore: row.combined_score,
        incidentId: row.incident_id,
        lesson: row.lesson,
        memoryId: row.memory_id,
        similarity: row.similarity,
        summary: row.summary,
      }));
  }

  async storeMemory(memory: StoredMemory): Promise<string> {
    const response = (await this.client.rpc("store_incident_memory", {
      p_embedding: vectorLiteral(memory.embedding),
      p_incident_id: memory.incidentId,
      p_lesson: memory.lesson,
      p_quality_score: memory.qualityScore,
      p_summary: memory.summary,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Memory write failed: ${response.error.message}`);
    return z.uuid().parse(response.data);
  }
}
