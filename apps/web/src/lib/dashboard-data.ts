import { PublicEnvironmentSchema } from "@pulse-atx/schemas";
import { z } from "zod";

export const DashboardRawEventSchema = z.object({
  external_id: z.string(),
  first_seen_at: z.string(),
  id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  processing_status: z.string(),
  revision: z.number().int().positive(),
  source: z.string(),
});

export const DashboardIncidentSchema = z.object({
  confidence: z.number().nullable(),
  id: z.uuid(),
  incident_type: z.string(),
  last_updated_at: z.string(),
  latitude: z.number().nullable(),
  location_name: z.string().nullable(),
  longitude: z.number().nullable(),
  predicted_duration_minutes: z.number().int().nullable(),
  severity: z.number().int().nullable(),
  status: z.string(),
  summary: z.string(),
  title: z.string(),
});

export const DashboardTimelineSchema = z.object({
  created_at: z.string(),
  event_type: z.string(),
  id: z.uuid(),
  incident_id: z.uuid().nullable(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const DashboardHealthSchema = z.object({
  last_heartbeat_at: z.string(),
  pending_jobs: z.number().int().nonnegative(),
  status: z.string(),
  worker_id: z.string(),
});

export const DashboardSecurityFindingSchema = z.object({
  action_taken: z.string(),
  created_at: z.string(),
  id: z.uuid(),
  severity: z.string(),
  stage: z.string(),
  threat_type: z.string(),
});

export const DashboardMissionSchema = z.object({
  completed_at: z.string().nullable(),
  current_step: z.number().int().nonnegative(),
  failure_reason: z.string().nullable(),
  goal: z.string(),
  id: z.uuid(),
  incident_id: z.uuid(),
  next_wake_at: z.string().nullable(),
  plan_version: z.number().int().min(1).max(4),
  priority: z.number().int().min(1).max(5),
  started_at: z.string(),
  status: z.enum([
    "planning",
    "active",
    "waiting",
    "waiting_approval",
    "completed",
    "cancelled",
    "failed",
  ]),
  success_criteria: z.array(z.string()),
  trigger_reason: z.record(z.string(), z.unknown()),
  updated_at: z.string(),
  wake_cycle: z.number().int().nonnegative(),
});

export const DashboardMissionStepSchema = z.object({
  completed_at: z.string().nullable(),
  created_at: z.string(),
  decision_audit: z
    .object({
      alternatives: z.array(
        z.object({
          confidence: z.number().min(0).max(1),
          expectedBenefit: z.string(),
          expectedRisk: z.string(),
          name: z.string(),
          reversibility: z.enum(["high", "medium", "low"]),
        }),
      ),
      selectedAction: z.string(),
      selectionReason: z.string(),
    })
    .nullable(),
  error: z.string().nullable(),
  id: z.uuid(),
  mission_id: z.uuid(),
  plan_version: z.number().int().min(1).max(4),
  rationale: z.string().nullable(),
  result: z.unknown(),
  status: z.enum([
    "planned",
    "running",
    "waiting",
    "waiting_approval",
    "completed",
    "failed",
    "skipped",
    "cancelled",
  ]),
  step_order: z.number().int().min(1).max(8),
  tool_arguments: z.record(z.string(), z.unknown()),
  tool_name: z.string(),
});

export const DashboardObservationSchema = z.object({
  change_summary: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  id: z.uuid(),
  incident_id: z.uuid(),
  mission_id: z.uuid(),
  observation_type: z.string(),
  state_fingerprint: z.string(),
  state_snapshot: z.object({
    affectedRoutes: z.array(z.string()),
    blockedLanes: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    correlatedFeedCount: z.number().int().nonnegative(),
    geographicSpreadKm: z.number().nonnegative(),
    incidentId: z.uuid(),
    observedDurationMinutes: z
      .number()
      .int()
      .nonnegative()
      .max(1_440)
      .optional(),
    predictedDurationMinutes: z.number().int().nonnegative(),
    severity: z.number().int().min(1).max(5),
    status: z.string(),
    transitDelayMinutes: z.number().int().nonnegative(),
    updatedAt: z.string(),
    weatherSeverity: z.string(),
  }),
});

export const DashboardToolExecutionSchema = z.object({
  approval_alert_id: z.uuid().nullable(),
  approval_status: z
    .enum(["approved", "not_required", "pending", "rejected"])
    .nullable(),
  arguments: z.record(z.string(), z.unknown()),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  error: z.string().nullable(),
  id: z.uuid(),
  mission_id: z.uuid(),
  mission_step_id: z.uuid().nullable(),
  result: z.unknown(),
  security_status: z.string(),
  status: z.enum(["pending", "running", "blocked", "completed", "failed"]),
  tool_name: z.string(),
});

export type DashboardRawEvent = z.infer<typeof DashboardRawEventSchema>;
export type DashboardIncident = z.infer<typeof DashboardIncidentSchema>;
export type DashboardTimeline = z.infer<typeof DashboardTimelineSchema>;
export type DashboardHealth = z.infer<typeof DashboardHealthSchema>;
export type DashboardSecurityFinding = z.infer<
  typeof DashboardSecurityFindingSchema
>;
export type DashboardMission = z.infer<typeof DashboardMissionSchema>;
export type DashboardMissionStep = z.infer<typeof DashboardMissionStepSchema>;
export type DashboardObservation = z.infer<typeof DashboardObservationSchema>;
export type DashboardToolExecution = z.infer<
  typeof DashboardToolExecutionSchema
>;

export interface DashboardSnapshot {
  config: { anonKey: string; controlUrl: string | null; url: string } | null;
  error: string | null;
  health: DashboardHealth | null;
  incidents: DashboardIncident[];
  missionSteps: DashboardMissionStep[];
  missions: DashboardMission[];
  observations: DashboardObservation[];
  rawEvents: DashboardRawEvent[];
  securityFindings: DashboardSecurityFinding[];
  timeline: DashboardTimeline[];
  toolExecutions: DashboardToolExecution[];
}

async function fetchRows<T>(
  baseUrl: string,
  anonKey: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    cache: "no-store",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(
      `Supabase ${path.split("?")[0]} returned ${response.status}`,
    );
  return schema.parse(await response.json());
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const environment = PublicEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_AGENT_CONTROL_URL: process.env.NEXT_PUBLIC_AGENT_CONTROL_URL,
  });
  if (
    !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !environment.NEXT_PUBLIC_SUPABASE_URL
  ) {
    return {
      config: null,
      error: null,
      health: null,
      incidents: [],
      missionSteps: [],
      missions: [],
      observations: [],
      rawEvents: [],
      securityFindings: [],
      timeline: [],
      toolExecutions: [],
    };
  }

  const config = {
    anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    controlUrl: environment.NEXT_PUBLIC_AGENT_CONTROL_URL ?? null,
    url: environment.NEXT_PUBLIC_SUPABASE_URL,
  };
  try {
    const [
      rawEvents,
      incidents,
      timeline,
      healthRows,
      securityFindings,
      missions,
      missionSteps,
      observations,
      toolExecutions,
    ] = await Promise.all([
      fetchRows(
        config.url,
        config.anonKey,
        "raw_events?select=id,source,external_id,payload,revision,first_seen_at,processing_status&order=first_seen_at.desc&limit=50",
        z.array(DashboardRawEventSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "incidents?select=id,title,summary,incident_type,status,severity,confidence,latitude,longitude,location_name,predicted_duration_minutes,last_updated_at&status=in.(analyzing,active,monitoring)&order=last_updated_at.desc&limit=50",
        z.array(DashboardIncidentSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "agent_timeline?select=id,incident_id,event_type,message,metadata,created_at&order=created_at.desc&limit=250",
        z.array(DashboardTimelineSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "agent_health?select=worker_id,status,last_heartbeat_at,pending_jobs&order=last_heartbeat_at.desc&limit=1",
        z.array(DashboardHealthSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "security_findings?select=id,stage,threat_type,severity,action_taken,created_at&order=created_at.desc&limit=10",
        z.array(DashboardSecurityFindingSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "agent_missions?select=id,incident_id,goal,status,priority,current_step,plan_version,wake_cycle,trigger_reason,success_criteria,next_wake_at,started_at,completed_at,failure_reason,updated_at&order=created_at.desc&limit=50",
        z.array(DashboardMissionSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "agent_mission_steps?select=id,mission_id,step_order,plan_version,tool_name,tool_arguments,rationale,status,result,decision_audit,error,completed_at,created_at&order=created_at.desc&limit=200",
        z.array(DashboardMissionStepSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "agent_observations?select=id,mission_id,incident_id,observation_type,state_snapshot,state_fingerprint,change_summary,created_at&order=created_at.desc&limit=100",
        z.array(DashboardObservationSchema),
      ),
      fetchRows(
        config.url,
        config.anonKey,
        "agent_tool_executions?select=id,mission_id,mission_step_id,approval_alert_id,tool_name,arguments,security_status,approval_status,status,result,error,completed_at,created_at&order=created_at.desc&limit=100",
        z.array(DashboardToolExecutionSchema),
      ),
    ]);
    return {
      config,
      error: null,
      health: healthRows[0] ?? null,
      incidents,
      missionSteps,
      missions,
      observations,
      rawEvents,
      securityFindings,
      timeline,
      toolExecutions,
    };
  } catch (error) {
    return {
      config,
      error:
        error instanceof Error ? error.message : "Dashboard snapshot failed",
      health: null,
      incidents: [],
      missionSteps: [],
      missions: [],
      observations: [],
      rawEvents: [],
      securityFindings: [],
      timeline: [],
      toolExecutions: [],
    };
  }
}
