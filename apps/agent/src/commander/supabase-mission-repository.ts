import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  CounterfactualAuditSchema,
  MissionStatusSchema,
  MissionStepStatusSchema,
} from "./mission-schemas.js";
import type {
  CreateMissionInput,
  MissionObservationRecord,
  MissionRecord,
  MissionRuntimeRepository,
  MissionStepRecord,
  MissionStepResultInput,
  MissionTimelineEvent,
  MissionTransitionPatch,
  PersistPlanInput,
  ToolExecutionRecord,
} from "./mission-repository.js";
import {
  ImpactChangeSchema,
  IncidentSnapshotSchema,
  ToolNameSchema,
} from "./tools/types.js";

const MissionRowSchema = z.object({
  assumptions: z.array(z.string()),
  completed_at: z.string().nullable(),
  current_step: z.number().int().nonnegative(),
  failure_reason: z.string().nullable(),
  goal: z.string(),
  id: z.uuid(),
  incident_id: z.uuid(),
  next_wake_at: z.string().nullable(),
  plan_version: z.number().int().min(1).max(3),
  priority: z.number().int().min(1).max(5),
  started_at: z.string(),
  status: MissionStatusSchema,
  success_criteria: z.array(z.string()),
  trigger_reason: z.record(z.string(), z.unknown()),
  updated_at: z.string(),
  wake_cycle: z.number().int().nonnegative(),
});

const StepRowSchema = z.object({
  completed_at: z.string().nullable(),
  decision_audit: CounterfactualAuditSchema.nullable(),
  error: z.string().nullable(),
  id: z.uuid(),
  mission_id: z.uuid(),
  plan_version: z.number().int().min(1).max(3),
  rationale: z.string().nullable(),
  requires_fresh_observation: z.boolean(),
  result: z.unknown(),
  started_at: z.string().nullable(),
  status: MissionStepStatusSchema,
  step_order: z.number().int().min(1).max(8),
  tool_arguments: z.record(z.string(), z.unknown()),
  tool_name: ToolNameSchema,
});

const ObservationRowSchema = z.object({
  change_summary: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  id: z.uuid(),
  incident_id: z.uuid(),
  mission_id: z.uuid(),
  observation_type: z.string(),
  state_fingerprint: z.string(),
  state_snapshot: IncidentSnapshotSchema,
});

const ToolExecutionRowSchema = z.object({
  approval_alert_id: z.string().nullable(),
  approval_status: z
    .enum(["approved", "not_required", "pending", "rejected"])
    .nullable(),
  arguments: z.record(z.string(), z.unknown()),
  arguments_fingerprint: z.string(),
  completed_at: z.string().nullable(),
  error: z.string().nullable(),
  id: z.uuid(),
  latency_ms: z.number().int().nonnegative().nullable(),
  mission_id: z.uuid(),
  mission_step_id: z.string().nullable(),
  result: z.unknown(),
  security_status: z.string(),
  started_at: z.string().nullable(),
  status: z.enum(["blocked", "completed", "failed", "pending", "running"]),
  tool_name: ToolNameSchema,
});

function missionFromRow(value: unknown): MissionRecord {
  const row = MissionRowSchema.parse(value);
  return {
    assumptions: row.assumptions,
    completedAt: row.completed_at,
    currentStep: row.current_step,
    failureReason: row.failure_reason,
    goal: row.goal,
    id: row.id,
    incidentId: row.incident_id,
    nextWakeAt: row.next_wake_at,
    planVersion: row.plan_version,
    priority: row.priority,
    startedAt: row.started_at,
    status: row.status,
    successCriteria: row.success_criteria,
    triggerReason: row.trigger_reason,
    updatedAt: row.updated_at,
    wakeCycle: row.wake_cycle,
  };
}

function stepFromRow(value: unknown): MissionStepRecord {
  const row = StepRowSchema.parse(value);
  return {
    completedAt: row.completed_at,
    decisionAudit: row.decision_audit,
    error: row.error,
    id: row.id,
    missionId: row.mission_id,
    planVersion: row.plan_version,
    rationale: row.rationale ?? "Operational tool step",
    requiresFreshObservation: row.requires_fresh_observation,
    result: row.result,
    startedAt: row.started_at,
    status: row.status,
    stepOrder: row.step_order,
    toolArguments: row.tool_arguments,
    toolName: row.tool_name,
  };
}

function observationFromRow(value: unknown): MissionObservationRecord {
  const row = ObservationRowSchema.parse(value);
  const parsedChange = ImpactChangeSchema.safeParse(row.change_summary);
  return {
    changeSummary: parsedChange.success ? parsedChange.data : {},
    createdAt: row.created_at,
    id: row.id,
    incidentId: row.incident_id,
    missionId: row.mission_id,
    observationType: row.observation_type,
    stateFingerprint: row.state_fingerprint,
    stateSnapshot: row.state_snapshot,
  };
}

function executionFromRow(value: unknown): ToolExecutionRecord {
  const row = ToolExecutionRowSchema.parse(value);
  return {
    approvalAlertId: row.approval_alert_id,
    approvalStatus: row.approval_status,
    arguments: row.arguments,
    argumentsFingerprint: row.arguments_fingerprint,
    completedAt: row.completed_at,
    error: row.error,
    id: row.id,
    latencyMs: row.latency_ms,
    missionId: row.mission_id,
    missionStepId: row.mission_step_id,
    result: row.result,
    securityStatus: row.security_status,
    startedAt: row.started_at,
    status: row.status,
    toolName: row.tool_name,
  };
}

function responseError(
  prefix: string,
  error: { message: string } | null,
): void {
  if (error) throw new Error(`${prefix}: ${error.message}`);
}

export class SupabaseMissionRepository implements MissionRuntimeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async appendTimeline(event: MissionTimelineEvent): Promise<void> {
    const response = (await this.client.from("agent_timeline").insert({
      event_type: event.eventType,
      incident_id: event.incidentId,
      message: event.message,
      metadata: { ...event.metadata, missionId: event.missionId },
    })) as { error: { message: string } | null };
    responseError("Mission timeline write failed", response.error);
  }

  async createMission(
    input: CreateMissionInput,
  ): Promise<{ created: boolean; mission: MissionRecord }> {
    const response = (await this.client.rpc("create_agent_mission", {
      p_goal: input.goal,
      p_incident_id: input.incidentId,
      p_priority: input.priority,
      p_trigger_reason: input.triggerReason,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission creation failed", response.error);
    return { created: false, mission: missionFromRow(response.data) };
  }

  async getMission(missionId: string): Promise<MissionRecord | null> {
    const response = (await this.client
      .from("agent_missions")
      .select("*")
      .eq("id", missionId)
      .maybeSingle()) as { data: unknown; error: { message: string } | null };
    responseError("Mission lookup failed", response.error);
    return response.data ? missionFromRow(response.data) : null;
  }

  async getLatestObservation(
    missionId: string,
  ): Promise<MissionObservationRecord | null> {
    const response = (await this.client
      .from("agent_observations")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: unknown; error: { message: string } | null };
    responseError("Mission observation lookup failed", response.error);
    return response.data ? observationFromRow(response.data) : null;
  }

  async listSteps(
    missionId: string,
    planVersion: number,
  ): Promise<MissionStepRecord[]> {
    const response = (await this.client
      .from("agent_mission_steps")
      .select("*")
      .eq("mission_id", missionId)
      .eq("plan_version", planVersion)
      .order("step_order")) as {
      data: unknown;
      error: { message: string } | null;
    };
    responseError("Mission step lookup failed", response.error);
    return z.array(StepRowSchema).parse(response.data).map(stepFromRow);
  }

  async markStepRunning(stepId: string): Promise<MissionStepRecord> {
    const response = (await this.client.rpc("start_agent_mission_step", {
      p_step_id: stepId,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission step start failed", response.error);
    return stepFromRow(response.data);
  }

  async persistPlan(input: PersistPlanInput): Promise<MissionRecord> {
    const response = (await this.client.rpc("persist_agent_mission_plan", {
      p_mission_id: input.missionId,
      p_plan: input.plan,
      p_plan_version: input.planVersion,
      p_used_fallback: input.usedFallback,
      p_validation_failures: input.validationFailures,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission plan persistence failed", response.error);
    return missionFromRow(response.data);
  }

  async recordStepResult(
    input: MissionStepResultInput,
  ): Promise<MissionStepRecord> {
    const response = (await this.client.rpc("finish_agent_mission_step", {
      p_decision_audit: input.audit ?? null,
      p_error: input.error ?? null,
      p_result: input.result ?? null,
      p_status: input.status,
      p_step_id: input.stepId,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission step result persistence failed", response.error);
    return stepFromRow(response.data);
  }

  async recordObservation(input: {
    changeSummary: MissionObservationRecord["changeSummary"];
    incidentId: string;
    missionId: string;
    observationType: string;
    stateFingerprint: string;
    stateSnapshot: MissionObservationRecord["stateSnapshot"];
  }): Promise<MissionObservationRecord> {
    const insertResponse = (await this.client.from("agent_observations").upsert(
      {
        change_summary: input.changeSummary,
        incident_id: input.incidentId,
        mission_id: input.missionId,
        observation_type: input.observationType,
        state_fingerprint: input.stateFingerprint,
        state_snapshot: input.stateSnapshot,
      },
      { ignoreDuplicates: true, onConflict: "mission_id,state_fingerprint" },
    )) as { error: { message: string } | null };
    responseError("Mission observation write failed", insertResponse.error);
    const response = (await this.client
      .from("agent_observations")
      .select("*")
      .eq("mission_id", input.missionId)
      .eq("state_fingerprint", input.stateFingerprint)
      .single()) as { data: unknown; error: { message: string } | null };
    responseError("Mission observation readback failed", response.error);
    return observationFromRow(response.data);
  }

  async transitionMission(
    missionId: string,
    expected: MissionRecord["status"] | MissionRecord["status"][],
    status: MissionRecord["status"],
    patch: MissionTransitionPatch = {},
  ): Promise<MissionRecord> {
    const response = (await this.client.rpc("transition_agent_mission", {
      p_expected_statuses: Array.isArray(expected) ? expected : [expected],
      p_mission_id: missionId,
      p_patch: patch,
      p_status: status,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission transition failed", response.error);
    return missionFromRow(response.data);
  }

  async beginToolExecution(input: {
    approvalRequired: boolean;
    arguments: Record<string, unknown>;
    argumentsFingerprint: string;
    missionId: string;
    missionStepId: string;
    securityStatus: string;
    toolName: ToolExecutionRecord["toolName"];
  }): Promise<ToolExecutionRecord> {
    const response = (await this.client.rpc("begin_agent_tool_execution", {
      p_approval_required: input.approvalRequired,
      p_arguments: input.arguments,
      p_arguments_fingerprint: input.argumentsFingerprint,
      p_mission_id: input.missionId,
      p_mission_step_id: input.missionStepId,
      p_security_status: input.securityStatus,
      p_tool_name: input.toolName,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Tool execution start failed", response.error);
    return executionFromRow(response.data);
  }

  async claimMissions(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<MissionRecord[]> {
    const response = (await this.client.rpc("claim_agent_missions", {
      p_lease_seconds: leaseSeconds,
      p_limit: limit,
      p_worker_id: workerId,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission claim failed", response.error);
    return z.array(MissionRowSchema).parse(response.data).map(missionFromRow);
  }

  async decideToolApproval(
    executionId: string,
    operator: string,
    approved: boolean,
  ): Promise<ToolExecutionRecord> {
    const response = (await this.client.rpc("decide_agent_tool_approval", {
      p_approved: approved,
      p_execution_id: executionId,
      p_operator: operator,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Mission approval decision failed", response.error);
    return executionFromRow(response.data);
  }

  async finishToolExecution(input: {
    error: string | null;
    executionId: string;
    latencyMs: number;
    result: unknown;
    securityStatus: string;
    status: "blocked" | "completed" | "failed";
  }): Promise<ToolExecutionRecord> {
    const response = (await this.client.rpc("finish_agent_tool_execution", {
      p_error: input.error,
      p_execution_id: input.executionId,
      p_latency_ms: input.latencyMs,
      p_result: input.result,
      p_security_status: input.securityStatus,
      p_status: input.status,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Tool execution completion failed", response.error);
    return executionFromRow(response.data);
  }

  async getMissionApprovalDecision(
    missionId: string,
  ): Promise<"approved" | "pending" | "rejected" | null> {
    const response = (await this.client
      .from("agent_tool_executions")
      .select("approval_status")
      .eq("mission_id", missionId)
      .not("approval_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as {
      data: { approval_status?: unknown } | null;
      error: { message: string } | null;
    };
    responseError("Mission approval lookup failed", response.error);
    if (!response.data) return null;
    const status = z
      .enum(["approved", "not_required", "pending", "rejected"])
      .parse(response.data.approval_status);
    return status === "not_required" ? null : status;
  }

  async markToolExecutionRunning(
    executionId: string,
  ): Promise<ToolExecutionRecord> {
    const response = (await this.client
      .from("agent_tool_executions")
      .update({ started_at: new Date().toISOString(), status: "running" })
      .eq("id", executionId)
      .in("status", ["pending", "blocked"])
      .select("*")
      .single()) as { data: unknown; error: { message: string } | null };
    responseError("Tool execution claim failed", response.error);
    return executionFromRow(response.data);
  }

  async releaseClaim(missionId: string, workerId: string): Promise<void> {
    const response = (await this.client.rpc("release_agent_mission_claim", {
      p_mission_id: missionId,
      p_worker_id: workerId,
    })) as { error: { message: string } | null };
    responseError("Mission claim release failed", response.error);
  }
}
