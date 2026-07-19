import { z } from "zod";

import { compareIncidentSnapshots } from "./change-detector.js";
import { AgentToolRegistry } from "./registry.js";
import {
  AlertDraftResultSchema,
  ImpactChangeSchema,
  IncidentSnapshotSchema,
  MissionLessonSchema,
  SimilarIncidentSchema,
  TransitRouteSchema,
  WeatherConditionsSchema,
  type AgentTool,
  type ToolContext,
} from "./types.js";

const IncidentIdSchema = z.object({ incidentId: z.uuid() });
const AudienceSchema = z.enum([
  "affected_routes",
  "city_operators",
  "citywide",
]);

function enforceIncidentScope(incidentId: string, context: ToolContext): void {
  if (incidentId !== context.incidentId) {
    throw new Error("Tool arguments escaped the active incident scope");
  }
}

function enforceMissionScope(missionId: string, context: ToolContext): void {
  if (missionId !== context.missionId) {
    throw new Error("Tool arguments escaped the active mission scope");
  }
}

const alertInputFields = {
  affectedRoutes: z.array(z.string().min(1)).max(12),
  audience: AudienceSchema,
  incidentId: z.uuid(),
  message: z.string().min(10).max(2_000),
  severity: z.number().int().min(1).max(5),
  title: z.string().min(5).max(200),
};

const readSecurity = {
  impact: "read",
  networkAccess: "supabase",
  reversible: true,
} as const;
const writeSecurity = {
  impact: "write",
  networkAccess: "supabase",
  reversible: true,
} as const;
const highSecurity = {
  impact: "high",
  networkAccess: "supabase",
  reversible: false,
} as const;

function readTool<TInput, TOutput>(
  tool: Omit<
    AgentTool<TInput, TOutput>,
    "idempotencyStrategy" | "requiresApproval" | "securityPolicy"
  >,
): AgentTool<TInput, TOutput> {
  return {
    ...tool,
    idempotencyStrategy: "read_only",
    requiresApproval: () => false,
    securityPolicy: readSecurity,
  };
}

export function createDefaultToolRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();

  registry.register(
    readTool({
      description:
        "Retrieve bounded historical incidents and mission lessons similar to the active incident.",
      execute: async (input, context) => {
        enforceIncidentScope(input.incidentId, context);
        return context.operations.retrieveSimilarIncidents(
          input.incidentId,
          input.limit,
        );
      },
      inputSchema: IncidentIdSchema.extend({
        limit: z.number().int().min(1).max(10).default(6),
      }),
      name: "retrieve_similar_incidents",
      outputSchema: z.array(SimilarIncidentSchema).max(10),
      timeoutMs: 8_000,
    }),
  );

  registry.register(
    readTool({
      description:
        "Fetch a fresh, correlated traffic, transit, and weather snapshot for the active incident.",
      execute: async (input, context) => {
        enforceIncidentScope(input.incidentId, context);
        return context.operations.getIncidentSnapshot(input.incidentId);
      },
      inputSchema: IncidentIdSchema,
      name: "get_incident_snapshot",
      outputSchema: IncidentSnapshotSchema,
      timeoutMs: 8_000,
    }),
  );

  registry.register(
    readTool({
      description:
        "Find transit routes already correlated to the incident location and live feed evidence.",
      execute: async (input, context) => {
        enforceIncidentScope(input.incidentId, context);
        return context.operations.findAffectedTransitRoutes(input.incidentId);
      },
      inputSchema: IncidentIdSchema,
      name: "find_affected_transit_routes",
      outputSchema: z.array(TransitRouteSchema).max(20),
      timeoutMs: 8_000,
    }),
  );

  registry.register(
    readTool({
      description:
        "Read correlated NOAA conditions without constructing an arbitrary URL.",
      execute: async (input, context) => {
        enforceIncidentScope(input.incidentId, context);
        return context.operations.checkWeatherConditions(input.incidentId);
      },
      inputSchema: IncidentIdSchema,
      name: "check_weather_conditions",
      outputSchema: WeatherConditionsSchema,
      timeoutMs: 8_000,
    }),
  );

  registry.register({
    description:
      "Deterministically compare numeric and categorical incident state changes.",
    execute: (input) =>
      Promise.resolve(compareIncidentSnapshots(input.before, input.after)),
    idempotencyStrategy: "read_only",
    inputSchema: z.object({
      after: IncidentSnapshotSchema,
      before: IncidentSnapshotSchema,
    }),
    name: "calculate_impact_change",
    outputSchema: ImpactChangeSchema,
    requiresApproval: () => false,
    securityPolicy: { impact: "read", networkAccess: "none", reversible: true },
    timeoutMs: 1_000,
  });

  registry.register({
    description:
      "Persist an evidence-backed incident severity change within the active incident.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.updateIncidentSeverity(input);
    },
    idempotencyStrategy: "mission_arguments",
    inputSchema: IncidentIdSchema.extend({
      reason: z.string().min(10).max(500),
      severity: z.number().int().min(1).max(5),
    }),
    name: "update_incident_severity",
    outputSchema: z.object({
      incidentId: z.uuid(),
      previousSeverity: z.number().int().min(1).max(5),
      severity: z.number().int().min(1).max(5),
    }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description:
      "Create one bounded commuter or operator alert draft for the active incident.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.createAlertDraft(input);
    },
    idempotencyStrategy: "alert_singleton",
    inputSchema: z.object(alertInputFields),
    name: "create_alert_draft",
    outputSchema: AlertDraftResultSchema,
    requiresApproval: (input) => input.audience === "citywide",
    securityPolicy: writeSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description:
      "Revise an existing active incident alert without creating a duplicate alert.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.reviseAlertDraft(input);
    },
    idempotencyStrategy: "alert_singleton",
    inputSchema: z.object({ alertId: z.uuid(), ...alertInputFields }),
    name: "revise_alert_draft",
    outputSchema: AlertDraftResultSchema,
    requiresApproval: (input) => input.audience === "citywide",
    securityPolicy: writeSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description:
      "Create or reuse the pending operator approval boundary for a protected alert action.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.requestHumanApproval(input);
    },
    idempotencyStrategy: "alert_singleton",
    inputSchema: z.object({
      alertId: z.uuid(),
      audience: AudienceSchema,
      impact: z.string().min(5).max(500),
      incidentId: z.uuid(),
      rationale: z.string().min(5).max(1_000),
      summary: z.string().min(5).max(500),
    }),
    name: "request_human_approval",
    outputSchema: z.object({
      alertId: z.uuid(),
      status: z.literal("pending_approval"),
    }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description:
      "Publish an approved alert only to the internal dashboard simulation channel.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.publishSimulatedAlert(input);
    },
    idempotencyStrategy: "alert_singleton",
    inputSchema: z.object({ alertId: z.uuid(), incidentId: z.uuid() }),
    name: "publish_simulated_alert",
    outputSchema: z.object({
      alertId: z.uuid(),
      channel: z.literal("dashboard_simulation"),
      publishedAt: z.iso.datetime(),
    }),
    requiresApproval: () => true,
    securityPolicy: highSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description: "Persist a bounded future wake time for the current mission.",
    execute: async (input, context) => {
      enforceMissionScope(input.missionId, context);
      return context.operations.scheduleIncidentRecheck(input);
    },
    idempotencyStrategy: "mission_arguments",
    inputSchema: z.object({
      afterSeconds: z.number().int().min(15).max(300),
      missionId: z.uuid(),
    }),
    name: "schedule_incident_recheck",
    outputSchema: z.object({
      missionId: z.uuid(),
      nextWakeAt: z.iso.datetime(),
    }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 5_000,
  });

  registry.register({
    description:
      "Cancel a pending mission action that no longer matches live conditions.",
    execute: async (input, context) => {
      enforceMissionScope(input.missionId, context);
      return context.operations.cancelPendingAction(input);
    },
    idempotencyStrategy: "mission_arguments",
    inputSchema: z.object({
      missionId: z.uuid(),
      reason: z.string().min(5).max(500),
      toolExecutionId: z.uuid().optional(),
    }),
    name: "cancel_pending_action",
    outputSchema: z.object({ cancelled: z.boolean() }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 5_000,
  });

  registry.register({
    description:
      "Resolve the active incident after the final monitoring cycle confirms recovery.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.closeIncident(input);
    },
    idempotencyStrategy: "incident_singleton",
    inputSchema: IncidentIdSchema.extend({
      resolution: z.string().min(10).max(1_000),
    }),
    name: "close_incident",
    outputSchema: z.object({
      closedAt: z.iso.datetime(),
      incidentId: z.uuid(),
      status: z.literal("resolved"),
    }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description:
      "Store the observed incident duration, severity, and mission outcome idempotently.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      return context.operations.recordIncidentOutcome(input);
    },
    idempotencyStrategy: "incident_singleton",
    inputSchema: IncidentIdSchema.extend({
      actualDurationMinutes: z.number().int().nonnegative().max(1_440),
      observedSeverity: z.number().int().min(1).max(5),
      outcome: z.record(z.string(), z.unknown()),
    }),
    name: "record_incident_outcome",
    outputSchema: z.object({ outcomeId: z.uuid() }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 8_000,
  });

  registry.register({
    description:
      "Embed and store a structured completed-mission lesson through the existing memory pipeline.",
    execute: async (input, context) => {
      enforceIncidentScope(input.incidentId, context);
      enforceMissionScope(input.missionId, context);
      return context.operations.storeIncidentLesson(input);
    },
    idempotencyStrategy: "incident_singleton",
    inputSchema: z.object({
      incidentId: z.uuid(),
      lesson: MissionLessonSchema,
      missionId: z.uuid(),
    }),
    name: "store_incident_lesson",
    outputSchema: z.object({ memoryId: z.uuid() }),
    requiresApproval: () => false,
    securityPolicy: writeSecurity,
    timeoutMs: 15_000,
  });

  return registry;
}
