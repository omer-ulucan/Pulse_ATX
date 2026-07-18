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
  message: z.string(),
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

export type DashboardRawEvent = z.infer<typeof DashboardRawEventSchema>;
export type DashboardIncident = z.infer<typeof DashboardIncidentSchema>;
export type DashboardTimeline = z.infer<typeof DashboardTimelineSchema>;
export type DashboardHealth = z.infer<typeof DashboardHealthSchema>;
export type DashboardSecurityFinding = z.infer<
  typeof DashboardSecurityFindingSchema
>;

export interface DashboardSnapshot {
  config: { anonKey: string; url: string } | null;
  error: string | null;
  health: DashboardHealth | null;
  incidents: DashboardIncident[];
  rawEvents: DashboardRawEvent[];
  securityFindings: DashboardSecurityFinding[];
  timeline: DashboardTimeline[];
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
      rawEvents: [],
      securityFindings: [],
      timeline: [],
    };
  }

  const config = {
    anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    url: environment.NEXT_PUBLIC_SUPABASE_URL,
  };
  try {
    const [rawEvents, incidents, timeline, healthRows, securityFindings] =
      await Promise.all([
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
          "agent_timeline?select=id,event_type,message,created_at&order=created_at.desc&limit=30",
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
      ]);
    return {
      config,
      error: null,
      health: healthRows[0] ?? null,
      incidents,
      rawEvents,
      securityFindings,
      timeline,
    };
  } catch (error) {
    return {
      config,
      error:
        error instanceof Error ? error.message : "Dashboard snapshot failed",
      health: null,
      incidents: [],
      rawEvents: [],
      securityFindings: [],
      timeline: [],
    };
  }
}
