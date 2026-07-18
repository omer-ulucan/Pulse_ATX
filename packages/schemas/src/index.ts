import { z } from "zod";

export const EventSourceSchema = z.enum([
  "austin_traffic",
  "capmetro",
  "noaa_weather",
  "austin_fire",
  "demo",
]);

export const NormalizedEventSchema = z.object({
  eventType: z.string().min(1),
  externalId: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  latitude: z.number().min(-90).max(90).nullable(),
  locationName: z.string().min(1).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  payload: z.record(z.string(), z.unknown()),
  source: EventSourceSchema,
  sourceCreatedAt: z.iso.datetime().nullable(),
  sourceUpdatedAt: z.iso.datetime().nullable(),
  status: z.string().min(1),
  summary: z.string().min(1),
});

export type EventSource = z.infer<typeof EventSourceSchema>;
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

export const AffectedEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "road",
    "transit_route",
    "weather_area",
    "neighborhood",
    "facility",
  ]),
});

export const MemoryEffectSchema = z.object({
  adjusted_prediction_minutes: z.number().int().nonnegative(),
  base_prediction_minutes: z.number().int().nonnegative(),
  similar_incident_count: z.number().int().nonnegative(),
  used_historical_memory: z.boolean(),
});

export const IncidentDecisionSchema = z.object({
  affected_entities: z.array(AffectedEntitySchema).max(20),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).min(1).max(20),
  incident_type: z.string().min(1),
  memory_effect: MemoryEffectSchema,
  predicted_duration_minutes: z.number().int().min(0).max(1440),
  recommended_actions: z.array(z.string().min(1)).max(12),
  requires_human_approval: z.boolean(),
  severity: z.number().int().min(1).max(5),
  summary: z.string().min(1).max(1200),
  title: z.string().min(1).max(160),
});

export type IncidentDecision = z.infer<typeof IncidentDecisionSchema>;

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");
const integerString = (
  defaultValue: number,
  minimum: number,
  maximum: number,
) => z.coerce.number().int().min(minimum).max(maximum).default(defaultValue);

const AgentEnvironmentSchema = z
  .object({
    AUSTIN_TRAFFIC_FEED_URL: optionalUrl,
    CAPMETRO_FEED_URL: optionalUrl,
    DEMO_MODE: booleanString,
    DEMO_SECRET: optionalString,
    EMBEDDING_API_KEY: optionalString,
    EMBEDDING_BASE_URL: optionalUrl,
    EMBEDDING_MODEL: optionalString,
    HIDDENLAYER_API_KEY: optionalString,
    HIDDENLAYER_BASE_URL: optionalUrl,
    HEARTBEAT_INTERVAL_MS: integerString(5_000, 1_000, 60_000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    NEMOTRON_MODEL: optionalString,
    NOAA_ALERTS_URL: optionalUrl,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_URL: optionalUrl,
    STALE_JOB_AFTER_MS: integerString(120_000, 10_000, 3_600_000),
    TRAFFIC_POLL_INTERVAL_MS: integerString(10_000, 5_000, 300_000),
    VLLM_API_KEY: optionalString,
    VLLM_BASE_URL: optionalUrl,
    WORKER_ID: z.string().min(1).default("pulse-atx-local"),
  })
  .superRefine((value, context) => {
    if (!value.DEMO_MODE) {
      for (const key of [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "VLLM_BASE_URL",
        "NEMOTRON_MODEL",
        "HIDDENLAYER_API_KEY",
        "HIDDENLAYER_BASE_URL",
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            message: `${key} is required when DEMO_MODE=false`,
            path: [key],
          });
        }
      }
    }
  });

export type AgentEnvironment = z.infer<typeof AgentEnvironmentSchema>;

export function loadAgentEnvironment(
  environment: Record<string, string | undefined>,
): AgentEnvironment {
  const result = AgentEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(
      `Invalid agent environment: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export const PublicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
});

export type PublicEnvironment = z.infer<typeof PublicEnvironmentSchema>;
