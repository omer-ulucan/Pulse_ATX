import { mapBounded } from "@pulse-atx/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { LearningRepository } from "../memory/learning-repository.js";
import type { MemoryService } from "../memory/memory-service.js";
import type { MissionCandidateProvider } from "./mission-lifecycle.js";
import type {
  IncidentSnapshot,
  ToolOperations,
  TransitRouteSchema,
  WeatherConditionsSchema,
} from "./tools/types.js";

const IncidentRowSchema = z.object({
  confidence: z.number().nullable(),
  id: z.uuid(),
  incident_type: z.string(),
  last_updated_at: z.string(),
  latitude: z.number().nullable(),
  location_name: z.string().nullable(),
  longitude: z.number().nullable(),
  predicted_duration_minutes: z.number().int().nullable(),
  severity: z.number().int().nullable(),
  started_at: z.string().nullable(),
  status: z.enum([
    "analyzing",
    "active",
    "monitoring",
    "resolved",
    "quarantined",
  ]),
  summary: z.string(),
  title: z.string(),
});

const RawEventSchema = z.object({
  event_type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  source: z.string(),
  source_created_at: z.string().nullable(),
  source_updated_at: z.string().nullable(),
});

const LinkRowSchema = z.object({
  raw_events: z.union([RawEventSchema, z.array(RawEventSchema).max(1)]),
});

const AlertRowSchema = z.object({
  audience: z.enum(["affected_routes", "city_operators", "citywide"]),
  id: z.uuid(),
  requires_approval: z.boolean(),
  status: z.enum([
    "draft",
    "pending_approval",
    "approved",
    "published",
    "rejected",
  ]),
});

interface IncidentEvidence {
  incident: z.infer<typeof IncidentRowSchema>;
  rawEvents: z.infer<typeof RawEventSchema>[];
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function rawEventFromLink(
  link: z.infer<typeof LinkRowSchema>,
): z.infer<typeof RawEventSchema> | null {
  return Array.isArray(link.raw_events)
    ? (link.raw_events[0] ?? null)
    : link.raw_events;
}

function payloadText(payload: Record<string, unknown>): string {
  return Object.values(payload)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function weatherState(
  rawEvents: z.infer<typeof RawEventSchema>[],
): IncidentSnapshot["weatherSeverity"] {
  const weatherText = rawEvents
    .filter(
      (event) =>
        /noaa|weather/i.test(event.source) || /weather/i.test(event.event_type),
    )
    .map((event) => payloadText(event.payload))
    .join(" ");
  if (/tornado|flash flood|severe thunder|extreme/.test(weatherText))
    return "severe";
  if (/heavy rain|heavy rainfall|flood|downpour/.test(weatherText))
    return "heavy_rain";
  if (/rain|drizzle|shower/.test(weatherText)) return "light_rain";
  return "clear";
}

function blockedLanes(rawEvents: z.infer<typeof RawEventSchema>[]): number {
  let maximum = 0;
  for (const event of rawEvents) {
    for (const key of ["blocked_lanes", "lanes_blocked", "lane_blockage"]) {
      maximum = Math.max(maximum, numericValue(event.payload[key]) ?? 0);
    }
    const match = payloadText(event.payload).match(/(\d+)\s+lanes?\s+blocked/);
    maximum = Math.max(maximum, match?.[1] ? Number(match[1]) : 0);
    if (
      maximum === 0 &&
      /lane\s+blocked|lane-blocking/.test(payloadText(event.payload))
    ) {
      maximum = 1;
    }
  }
  return Math.trunc(maximum);
}

function affectedRoutes(rawEvents: z.infer<typeof RawEventSchema>[]): string[] {
  const routes = new Set<string>();
  for (const event of rawEvents) {
    for (const key of ["route_ids", "routes", "affected_routes"]) {
      for (const route of arrayStrings(event.payload[key])) routes.add(route);
    }
    for (const key of ["route_id", "route", "route_short_name"]) {
      const route = event.payload[key];
      if (typeof route === "string" && route.trim()) routes.add(route.trim());
    }
  }
  return [...routes].slice(0, 20);
}

function transitDelay(rawEvents: z.infer<typeof RawEventSchema>[]): number {
  let maximum = 0;
  for (const event of rawEvents) {
    for (const key of ["transit_delay_minutes", "delay_minutes", "delay_min"]) {
      maximum = Math.max(maximum, numericValue(event.payload[key]) ?? 0);
    }
  }
  return Math.round(maximum);
}

function geographicSpread(rawEvents: z.infer<typeof RawEventSchema>[]): number {
  return Math.max(
    0,
    ...rawEvents.map(
      (event) => numericValue(event.payload.geographic_spread_km) ?? 0,
    ),
  );
}

function responseError(
  prefix: string,
  error: { message: string } | null,
): void {
  if (error) throw new Error(`${prefix}: ${error.message}`);
}

export class SupabaseCommanderOperations
  implements ToolOperations, MissionCandidateProvider
{
  constructor(
    private readonly client: SupabaseClient,
    private readonly learning: LearningRepository,
    private readonly memory?: MemoryService,
  ) {}

  async listMissionCandidates(
    limit: number,
    signal?: AbortSignal,
  ): Promise<IncidentSnapshot[]> {
    if (signal?.aborted) throw signal.reason;
    const response = (await this.client
      .from("incidents")
      .select("id")
      .in("status", ["analyzing", "active", "monitoring"])
      .order("severity", { ascending: false, nullsFirst: false })
      .order("last_updated_at", { ascending: false })
      .limit(limit)) as {
      data: Array<{ id?: unknown }> | null;
      error: { message: string } | null;
    };
    responseError("Mission candidate lookup failed", response.error);
    const ids = z.array(z.object({ id: z.uuid() })).parse(response.data);
    return mapBounded(ids, 3, ({ id }) => this.getIncidentSnapshot(id));
  }

  async getIncidentSnapshot(incidentId: string): Promise<IncidentSnapshot> {
    const evidence = await this.getIncidentEvidence(incidentId);
    return {
      affectedRoutes: affectedRoutes(evidence.rawEvents),
      blockedLanes: blockedLanes(evidence.rawEvents),
      confidence: evidence.incident.confidence ?? 0.5,
      correlatedFeedCount: new Set(
        evidence.rawEvents.map((event) => event.source),
      ).size,
      geographicSpreadKm: geographicSpread(evidence.rawEvents),
      incidentId,
      predictedDurationMinutes:
        evidence.incident.predicted_duration_minutes ?? 0,
      severity: evidence.incident.severity ?? 1,
      status: evidence.incident.status,
      transitDelayMinutes: transitDelay(evidence.rawEvents),
      updatedAt: new Date(evidence.incident.last_updated_at).toISOString(),
      weatherSeverity: weatherState(evidence.rawEvents),
    };
  }

  async getRelevantLessons(
    snapshot: IncidentSnapshot,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    if (!this.memory) return [];
    const evidence = await this.getIncidentEvidence(snapshot.incidentId);
    return this.memory.retrieveForEvent(
      {
        address: evidence.incident.location_name,
        event_type: evidence.incident.incident_type,
        latitude: evidence.incident.latitude,
        longitude: evidence.incident.longitude,
        source_updated_at: snapshot.updatedAt,
        status: snapshot.status,
        summary: evidence.incident.summary,
        weather: snapshot.weatherSeverity,
      },
      signal,
    );
  }

  async retrieveSimilarIncidents(
    incidentId: string,
    limit: number,
  ): Promise<
    Array<{
      actualDurationMinutes: number;
      incidentId: string;
      lesson: Record<string, unknown>;
      similarity: number;
      summary: string;
    }>
  > {
    if (!this.memory) return [];
    const snapshot = await this.getIncidentSnapshot(incidentId);
    const matches = await this.getRelevantLessons(snapshot);
    const matchIds = matches
      .map((match) => match.incidentId)
      .filter((id): id is string => typeof id === "string")
      .slice(0, limit);
    if (matchIds.length === 0) return [];
    const outcomesResponse = (await this.client
      .from("incident_outcomes")
      .select("incident_id,actual_duration_minutes")
      .in("incident_id", matchIds)) as {
      data: unknown;
      error: { message: string } | null;
    };
    responseError(
      "Similar incident outcome lookup failed",
      outcomesResponse.error,
    );
    const outcomes = new Map(
      z
        .array(
          z.object({
            actual_duration_minutes: z.number().int().nonnegative().nullable(),
            incident_id: z.uuid(),
          }),
        )
        .parse(outcomesResponse.data)
        .map((row) => [row.incident_id, row.actual_duration_minutes ?? 0]),
    );
    return matches
      .filter(
        (match): match is typeof match & { incidentId: string } =>
          typeof match.incidentId === "string" &&
          matchIds.includes(match.incidentId),
      )
      .slice(0, limit)
      .map((match) => ({
        actualDurationMinutes: outcomes.get(match.incidentId) ?? 0,
        incidentId: match.incidentId,
        lesson:
          typeof match.lesson === "object" && match.lesson !== null
            ? (match.lesson as Record<string, unknown>)
            : {},
        similarity:
          typeof match.similarity === "number" ? match.similarity : 0.5,
        summary:
          typeof match.summary === "string"
            ? match.summary
            : "Prior completed Austin incident",
      }));
  }

  async findAffectedTransitRoutes(
    incidentId: string,
  ): Promise<z.infer<typeof TransitRouteSchema>[]> {
    const snapshot = await this.getIncidentSnapshot(incidentId);
    const major = new Set([
      "1",
      "7",
      "10",
      "20",
      "30",
      "300",
      "311",
      "801",
      "803",
    ]);
    return snapshot.affectedRoutes.map((routeId) => ({
      delayMinutes: snapshot.transitDelayMinutes,
      major: major.has(routeId.toUpperCase()),
      routeId,
      routeName: /^(801|803)$/.test(routeId)
        ? `Rapid ${routeId}`
        : `Route ${routeId}`,
    }));
  }

  async checkWeatherConditions(
    incidentId: string,
  ): Promise<z.infer<typeof WeatherConditionsSchema>> {
    const snapshot = await this.getIncidentSnapshot(incidentId);
    const precipitation =
      snapshot.weatherSeverity === "severe"
        ? "severe"
        : snapshot.weatherSeverity === "heavy_rain"
          ? "heavy"
          : snapshot.weatherSeverity === "light_rain"
            ? "light"
            : "none";
    return {
      amplification:
        precipitation === "severe" || precipitation === "heavy"
          ? "high"
          : precipitation === "light"
            ? "moderate"
            : "none",
      observedAt: snapshot.updatedAt,
      precipitation,
      summary:
        precipitation === "none"
          ? "No correlated precipitation signal is amplifying this incident."
          : `${precipitation} precipitation is amplifying current corridor disruption.`,
    };
  }

  async updateIncidentSeverity(input: {
    incidentId: string;
    reason: string;
    severity: number;
  }): Promise<{
    incidentId: string;
    previousSeverity: number;
    severity: number;
  }> {
    const before = await this.getIncidentSnapshot(input.incidentId);
    const response = (await this.client
      .from("incidents")
      .update({
        last_updated_at: new Date().toISOString(),
        severity: input.severity,
      })
      .eq("id", input.incidentId)
      .select("id,severity")
      .single()) as { data: unknown; error: { message: string } | null };
    responseError("Incident severity update failed", response.error);
    const updated = z
      .object({ id: z.uuid(), severity: z.number().int().min(1).max(5) })
      .parse(response.data);
    return {
      incidentId: updated.id,
      previousSeverity: before.severity,
      severity: updated.severity,
    };
  }

  createAlertDraft(input: {
    affectedRoutes: string[];
    audience: "affected_routes" | "city_operators" | "citywide";
    incidentId: string;
    message: string;
    severity: number;
    title: string;
  }) {
    return this.upsertAlert(input);
  }

  reviseAlertDraft(input: {
    affectedRoutes: string[];
    alertId?: string | undefined;
    audience: "affected_routes" | "city_operators" | "citywide";
    incidentId: string;
    message: string;
    severity: number;
    title: string;
  }) {
    return this.upsertAlert(input);
  }

  async requestHumanApproval(input: {
    alertId?: string | undefined;
    audience: "affected_routes" | "city_operators" | "citywide";
    impact: string;
    incidentId: string;
    rationale: string;
    summary: string;
  }): Promise<{ alertId: string; status: "pending_approval" }> {
    const alert = await this.resolveAlert(input.incidentId, input.alertId);
    const response = (await this.client
      .from("alerts")
      .update({ requires_approval: true, status: "pending_approval" })
      .eq("id", alert.id)) as { error: { message: string } | null };
    responseError("Alert approval request failed", response.error);
    return { alertId: alert.id, status: "pending_approval" };
  }

  async publishSimulatedAlert(input: {
    alertId?: string | undefined;
    incidentId: string;
  }): Promise<{
    alertId: string;
    channel: "dashboard_simulation";
    publishedAt: string;
  }> {
    const alert = await this.resolveAlert(input.incidentId, input.alertId);
    if (alert.status !== "approved") {
      throw new Error("Simulated publication requires an approved alert");
    }
    const publishedAt = new Date().toISOString();
    const response = (await this.client
      .from("alerts")
      .update({ status: "published" })
      .eq("id", alert.id)) as { error: { message: string } | null };
    responseError("Simulated alert publication failed", response.error);
    return { alertId: alert.id, channel: "dashboard_simulation", publishedAt };
  }

  async scheduleIncidentRecheck(input: {
    afterSeconds: number;
    missionId: string;
  }): Promise<{ missionId: string; nextWakeAt: string }> {
    const nextWakeAt = new Date(
      Date.now() + input.afterSeconds * 1_000,
    ).toISOString();
    const response = (await this.client
      .from("agent_missions")
      .update({ next_wake_at: nextWakeAt })
      .eq("id", input.missionId)) as { error: { message: string } | null };
    responseError("Mission wake scheduling failed", response.error);
    return { missionId: input.missionId, nextWakeAt };
  }

  async cancelPendingAction(input: {
    missionId: string;
    reason: string;
    toolExecutionId?: string | undefined;
  }): Promise<{ cancelled: boolean }> {
    let query = this.client
      .from("agent_tool_executions")
      .update({
        approval_status: "rejected",
        error: input.reason,
        status: "blocked",
      })
      .eq("mission_id", input.missionId)
      .eq("approval_status", "pending");
    if (input.toolExecutionId) query = query.eq("id", input.toolExecutionId);
    const response = (await query.select("id")) as {
      data: unknown;
      error: { message: string } | null;
    };
    responseError("Pending action cancellation failed", response.error);
    return {
      cancelled:
        z.array(z.object({ id: z.uuid() })).parse(response.data).length > 0,
    };
  }

  async closeIncident(input: {
    incidentId: string;
    resolution: string;
  }): Promise<{ closedAt: string; incidentId: string; status: "resolved" }> {
    const closedAt = new Date().toISOString();
    const response = (await this.client
      .from("incidents")
      .update({
        ended_at: closedAt,
        last_updated_at: closedAt,
        status: "resolved",
      })
      .eq("id", input.incidentId)) as { error: { message: string } | null };
    responseError("Incident closure failed", response.error);
    return { closedAt, incidentId: input.incidentId, status: "resolved" };
  }

  recordIncidentOutcome(input: {
    actualDurationMinutes: number;
    incidentId: string;
    observedSeverity: number;
    outcome: Record<string, unknown>;
  }): Promise<{ outcomeId: string }> {
    return this.learning
      .recordOutcome(
        input.incidentId,
        input.actualDurationMinutes,
        input.observedSeverity,
        input.outcome,
      )
      .then((outcomeId) => ({ outcomeId }));
  }

  async storeIncidentLesson(
    input: Parameters<ToolOperations["storeIncidentLesson"]>[0],
  ) {
    if (!this.memory) {
      throw new Error("Mission lesson storage requires the memory service");
    }
    const evidence = await this.getIncidentEvidence(input.incidentId);
    const memoryId = await this.memory.storeMissionLesson({
      incidentId: input.incidentId,
      incidentType: evidence.incident.incident_type,
      lesson: input.lesson,
      missionId: input.missionId,
    });
    return { memoryId };
  }

  private async getIncidentEvidence(
    incidentId: string,
  ): Promise<IncidentEvidence> {
    const [incidentResponse, linksResponse] = (await Promise.all([
      this.client.from("incidents").select("*").eq("id", incidentId).single(),
      this.client
        .from("incident_events")
        .select(
          "raw_events(source,event_type,payload,source_created_at,source_updated_at)",
        )
        .eq("incident_id", incidentId),
    ])) as [
      { data: unknown; error: { message: string } | null },
      { data: unknown; error: { message: string } | null },
    ];
    responseError("Incident lookup failed", incidentResponse.error);
    responseError("Incident evidence lookup failed", linksResponse.error);
    return {
      incident: IncidentRowSchema.parse(incidentResponse.data),
      rawEvents: z
        .array(LinkRowSchema)
        .parse(linksResponse.data)
        .map(rawEventFromLink)
        .filter(
          (event): event is z.infer<typeof RawEventSchema> => event !== null,
        ),
    };
  }

  private async resolveAlert(incidentId: string, alertId?: string) {
    let query = this.client
      .from("alerts")
      .select("id,audience,status,requires_approval")
      .eq("incident_id", incidentId);
    if (alertId) query = query.eq("id", alertId);
    else
      query = query
        .neq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(1);
    const response = (await query.maybeSingle()) as {
      data: unknown;
      error: { message: string } | null;
    };
    responseError("Active alert lookup failed", response.error);
    if (!response.data)
      throw new Error("No active alert exists for the incident");
    return AlertRowSchema.parse(response.data);
  }

  private async upsertAlert(input: {
    affectedRoutes: string[];
    audience: "affected_routes" | "city_operators" | "citywide";
    incidentId: string;
    message: string;
    severity: number;
    title: string;
  }) {
    const response = (await this.client.rpc("create_or_update_incident_alert", {
      p_audience: input.audience,
      p_incident_id: input.incidentId,
      p_message: input.message,
      p_recommended_actions: input.affectedRoutes.map(
        (route) => `Monitor Route ${route}`,
      ),
      p_requires_approval: input.audience === "citywide",
      p_severity: input.severity,
      p_title: input.title,
    })) as { data: unknown; error: { message: string } | null };
    responseError("Alert draft write failed", response.error);
    const alert = await this.resolveAlert(
      input.incidentId,
      z.uuid().parse(response.data),
    );
    return {
      alertId: alert.id,
      audience: alert.audience,
      requiresApproval: alert.requires_approval,
      status: alert.status,
    };
  }
}
