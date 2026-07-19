import { z } from "zod";

export const ToolNameSchema = z.enum([
  "retrieve_similar_incidents",
  "get_incident_snapshot",
  "find_affected_transit_routes",
  "check_weather_conditions",
  "calculate_impact_change",
  "update_incident_severity",
  "create_alert_draft",
  "revise_alert_draft",
  "request_human_approval",
  "publish_simulated_alert",
  "schedule_incident_recheck",
  "cancel_pending_action",
  "close_incident",
  "record_incident_outcome",
  "store_incident_lesson",
]);

export type ToolName = z.infer<typeof ToolNameSchema>;

export const IncidentSnapshotSchema = z.object({
  affectedRoutes: z.array(z.string().min(1)).max(20),
  blockedLanes: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  correlatedFeedCount: z.number().int().nonnegative(),
  geographicSpreadKm: z.number().nonnegative(),
  incidentId: z.uuid(),
  observedDurationMinutes: z.number().int().nonnegative().max(1_440).optional(),
  predictedDurationMinutes: z.number().int().nonnegative(),
  severity: z.number().int().min(1).max(5),
  status: z.enum([
    "analyzing",
    "active",
    "monitoring",
    "resolved",
    "quarantined",
  ]),
  transitDelayMinutes: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
  weatherSeverity: z.enum(["clear", "light_rain", "heavy_rain", "severe"]),
});

export type IncidentSnapshot = z.infer<typeof IncidentSnapshotSchema>;

const NumericChangeSchema = z.object({
  after: z.number(),
  before: z.number(),
  delta: z.number(),
});

const ValueChangeSchema = z.object({
  after: z.string(),
  before: z.string(),
  changed: z.boolean(),
});

export const ImpactChangeSchema = z.object({
  affectedRouteCount: NumericChangeSchema,
  blockedLanes: NumericChangeSchema,
  confidence: NumericChangeSchema,
  geographicSpreadKm: NumericChangeSchema,
  meaningful: z.boolean(),
  predictedDurationMinutes: NumericChangeSchema,
  severity: NumericChangeSchema,
  status: ValueChangeSchema,
  transitDelayMinutes: NumericChangeSchema,
  weatherSeverity: ValueChangeSchema,
});

export type ImpactChange = z.infer<typeof ImpactChangeSchema>;

export const SimilarIncidentSchema = z.object({
  actualDurationMinutes: z.number().int().nonnegative(),
  incidentId: z.uuid(),
  lesson: z.record(z.string(), z.unknown()),
  similarity: z.number().min(0).max(1),
  summary: z.string().min(1),
});

export const TransitRouteSchema = z.object({
  delayMinutes: z.number().int().nonnegative(),
  major: z.boolean(),
  routeId: z.string().min(1),
  routeName: z.string().min(1),
});

export const WeatherConditionsSchema = z.object({
  amplification: z.enum(["none", "moderate", "high"]),
  observedAt: z.iso.datetime(),
  precipitation: z.enum(["none", "light", "heavy", "severe"]),
  summary: z.string().min(1),
});

export const AlertDraftResultSchema = z.object({
  alertId: z.uuid(),
  audience: z.enum(["affected_routes", "city_operators", "citywide"]),
  requiresApproval: z.boolean(),
  status: z.enum([
    "draft",
    "pending_approval",
    "approved",
    "published",
    "rejected",
  ]),
});

export const MissionLessonSchema = z.object({
  actualOutcome: z.record(z.string(), z.unknown()),
  approvalBoundaries: z.array(z.string().min(1)).max(12),
  approvalLesson: z.string().min(1),
  finalPredictionError: z.number().nonnegative(),
  initialPlan: z.array(z.string().min(1)).min(1).max(8),
  pattern: z.string().min(5),
  planRevisions: z.array(z.string().min(1)).max(3),
  predictedOutcome: z.record(z.string(), z.unknown()),
  predictionLesson: z.string().min(1),
  recommendedResponsePattern: z.string().min(1),
  successfulActions: z.array(z.string().min(1)).max(12),
  timingLesson: z.string().min(1),
  toolsUsed: z.array(ToolNameSchema).max(15),
  triggerConditions: z.record(z.string(), z.unknown()),
  unnecessaryActions: z.array(z.string().min(1)).max(12),
});

export type MissionLesson = z.infer<typeof MissionLessonSchema>;

export type ToolLog = (
  message: string,
  context: Record<string, unknown>,
) => void;

export interface ToolOperations {
  cancelPendingAction(input: {
    missionId: string;
    reason: string;
    toolExecutionId?: string | undefined;
  }): Promise<{ cancelled: boolean }>;
  checkWeatherConditions(
    incidentId: string,
  ): Promise<z.infer<typeof WeatherConditionsSchema>>;
  closeIncident(input: {
    incidentId: string;
    resolution: string;
  }): Promise<{ closedAt: string; incidentId: string; status: "resolved" }>;
  createAlertDraft(input: {
    affectedRoutes: string[];
    audience: "affected_routes" | "city_operators" | "citywide";
    incidentId: string;
    message: string;
    severity: number;
    title: string;
  }): Promise<z.infer<typeof AlertDraftResultSchema>>;
  findAffectedTransitRoutes(
    incidentId: string,
  ): Promise<z.infer<typeof TransitRouteSchema>[]>;
  getIncidentSnapshot(incidentId: string): Promise<IncidentSnapshot>;
  publishSimulatedAlert(input: {
    alertId?: string | undefined;
    incidentId: string;
  }): Promise<{
    alertId: string;
    channel: "dashboard_simulation";
    publishedAt: string;
  }>;
  recordIncidentOutcome(input: {
    actualDurationMinutes: number;
    incidentId: string;
    observedSeverity: number;
    outcome: Record<string, unknown>;
  }): Promise<{ outcomeId: string }>;
  requestHumanApproval(input: {
    alertId?: string | undefined;
    audience: "affected_routes" | "city_operators" | "citywide";
    impact: string;
    incidentId: string;
    rationale: string;
    summary: string;
  }): Promise<{ alertId: string; status: "pending_approval" }>;
  retrieveSimilarIncidents(
    incidentId: string,
    limit: number,
  ): Promise<z.infer<typeof SimilarIncidentSchema>[]>;
  reviseAlertDraft(input: {
    affectedRoutes: string[];
    alertId?: string | undefined;
    audience: "affected_routes" | "city_operators" | "citywide";
    incidentId: string;
    message: string;
    severity: number;
    title: string;
  }): Promise<z.infer<typeof AlertDraftResultSchema>>;
  scheduleIncidentRecheck(input: {
    afterSeconds: number;
    missionId: string;
  }): Promise<{ missionId: string; nextWakeAt: string }>;
  storeIncidentLesson(input: {
    incidentId: string;
    lesson: MissionLesson;
    missionId: string;
  }): Promise<{ memoryId: string }>;
  updateIncidentSeverity(input: {
    incidentId: string;
    reason: string;
    severity: number;
  }): Promise<{
    incidentId: string;
    previousSeverity: number;
    severity: number;
  }>;
}

export interface ToolContext {
  affectedMajorRouteCount: number;
  confidence: number;
  incidentId: string;
  logger: ToolLog;
  missionId: string;
  missionStepId: string;
  operations: ToolOperations;
  securityConfidence: "ambiguous" | "confident";
  severity: number;
  wakeCycle?: number | undefined;
}

export interface ToolSecurityPolicy {
  impact: "high" | "read" | "write";
  networkAccess: "none" | "supabase";
  reversible: boolean;
}

export type ToolIdempotencyStrategy =
  | "alert_singleton"
  | "incident_singleton"
  | "mission_arguments"
  | "read_only";

export interface AgentTool<TInput, TOutput> {
  description: string;
  execute(
    input: TInput,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<TOutput>;
  idempotencyStrategy: ToolIdempotencyStrategy;
  inputSchema: z.ZodType<TInput>;
  name: ToolName;
  outputSchema: z.ZodType<TOutput>;
  requiresApproval(input: TInput, context: ToolContext): boolean;
  securityPolicy: ToolSecurityPolicy;
  timeoutMs: number;
}

export interface ValidatedToolCall {
  arguments: unknown;
  tool: ToolName;
}
