import { PublicEnvironmentSchema } from "@pulse-atx/schemas";
import { z } from "zod";

export const SecurityAlertSchema = z.object({
  approved_at: z.string().nullable(),
  approved_by: z.string().nullable(),
  created_at: z.string(),
  id: z.uuid(),
  message: z.string(),
  requires_approval: z.boolean(),
  severity: z.number().int().min(1).max(5),
  status: z.string(),
  title: z.string(),
});

export const SecurityFindingViewSchema = z.object({
  action_taken: z.string(),
  created_at: z.string(),
  details: z.record(z.string(), z.unknown()),
  id: z.uuid(),
  provider: z.string(),
  severity: z.string(),
  stage: z.string(),
  threat_type: z.string(),
});

export type SecurityAlert = z.infer<typeof SecurityAlertSchema>;
export type SecurityFindingView = z.infer<typeof SecurityFindingViewSchema>;

export interface SecuritySnapshot {
  alerts: SecurityAlert[];
  configured: boolean;
  controlUrl: string | null;
  error: string | null;
  findings: SecurityFindingView[];
}

async function fetchRows<T>(
  url: string,
  anonKey: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    cache: "no-store",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Supabase returned HTTP ${response.status}`);
  return schema.parse(await response.json());
}

export async function getSecuritySnapshot(): Promise<SecuritySnapshot> {
  const environment = PublicEnvironmentSchema.parse({
    NEXT_PUBLIC_AGENT_CONTROL_URL: process.env.NEXT_PUBLIC_AGENT_CONTROL_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const controlUrl = environment.NEXT_PUBLIC_AGENT_CONTROL_URL ?? null;
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!anonKey || !url) {
    return {
      alerts: [],
      configured: false,
      controlUrl,
      error: null,
      findings: [],
    };
  }
  try {
    const [alerts, findings] = await Promise.all([
      fetchRows(
        url,
        anonKey,
        "alerts?select=id,title,message,severity,status,requires_approval,approved_by,approved_at,created_at&order=created_at.desc&limit=30",
        z.array(SecurityAlertSchema),
      ),
      fetchRows(
        url,
        anonKey,
        "security_findings?select=id,stage,provider,threat_type,severity,action_taken,details,created_at&order=created_at.desc&limit=50",
        z.array(SecurityFindingViewSchema),
      ),
    ]);
    return { alerts, configured: true, controlUrl, error: null, findings };
  } catch (error) {
    return {
      alerts: [],
      configured: true,
      controlUrl,
      error:
        error instanceof Error ? error.message : "Security snapshot failed",
      findings: [],
    };
  }
}
