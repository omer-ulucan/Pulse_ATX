import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export interface AgentHealthUpdate {
  activeIncidents: number;
  heartbeatIntervalSeconds: number;
  lastHeartbeatAt: string;
  metadata: Record<string, unknown>;
  pendingJobs: number;
  status: "degraded" | "healthy" | "starting" | "stopping";
  workerId: string;
}

export interface QueueMetrics {
  activeIncidents: number;
  pendingJobs: number;
}

export interface RuntimeRepository {
  appendTimeline(
    eventType: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  getQueueMetrics(): Promise<QueueMetrics>;
  recoverStaleJobs(staleBefore: string): Promise<number>;
  updateAgentHealth(update: AgentHealthUpdate): Promise<void>;
}

const CountSchema = z.number().int().nonnegative();

export class SupabaseRuntimeRepository implements RuntimeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async appendTimeline(
    eventType: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const response = (await this.client.from("agent_timeline").insert({
      event_type: eventType,
      message,
      metadata,
    })) as { error: { message: string } | null };
    if (response.error)
      throw new Error(`Timeline write failed: ${response.error.message}`);
  }

  async getQueueMetrics(): Promise<QueueMetrics> {
    const [jobsResponse, incidentsResponse] = (await Promise.all([
      this.client
        .from("event_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      this.client
        .from("incidents")
        .select("id", { count: "exact", head: true })
        .in("status", ["analyzing", "active", "monitoring"]),
    ])) as [
      { count: number | null; error: { message: string } | null },
      { count: number | null; error: { message: string } | null },
    ];
    if (jobsResponse.error)
      throw new Error(`Queue count failed: ${jobsResponse.error.message}`);
    if (incidentsResponse.error) {
      throw new Error(
        `Incident count failed: ${incidentsResponse.error.message}`,
      );
    }
    return {
      activeIncidents: CountSchema.parse(incidentsResponse.count ?? 0),
      pendingJobs: CountSchema.parse(jobsResponse.count ?? 0),
    };
  }

  async recoverStaleJobs(staleBefore: string): Promise<number> {
    const response = (await this.client.rpc("recover_stale_event_jobs", {
      p_stale_before: staleBefore,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Stale job recovery failed: ${response.error.message}`);
    return CountSchema.parse(response.data);
  }

  async updateAgentHealth(update: AgentHealthUpdate): Promise<void> {
    const response = (await this.client.from("agent_health").upsert(
      {
        active_incidents: update.activeIncidents,
        heartbeat_interval_seconds: update.heartbeatIntervalSeconds,
        last_heartbeat_at: update.lastHeartbeatAt,
        metadata: update.metadata,
        pending_jobs: update.pendingJobs,
        status: update.status,
        worker_id: update.workerId,
      },
      { onConflict: "worker_id" },
    )) as { error: { message: string } | null };
    if (response.error)
      throw new Error(`Agent health write failed: ${response.error.message}`);
  }
}
