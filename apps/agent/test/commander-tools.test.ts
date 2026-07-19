import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDefaultToolRegistry } from "../src/commander/tools/default-tools.js";
import type {
  IncidentSnapshot,
  ToolContext,
  ToolOperations,
} from "../src/commander/tools/types.js";

const incidentId = randomUUID();
const missionId = randomUUID();

function snapshot(overrides: Partial<IncidentSnapshot> = {}): IncidentSnapshot {
  return {
    affectedRoutes: ["801"],
    blockedLanes: 1,
    confidence: 0.78,
    correlatedFeedCount: 3,
    geographicSpreadKm: 1.2,
    incidentId,
    predictedDurationMinutes: 24,
    severity: 3,
    status: "active",
    transitDelayMinutes: 5,
    updatedAt: "2026-07-19T14:00:00.000Z",
    weatherSeverity: "heavy_rain",
    ...overrides,
  };
}

class MockOperations implements ToolOperations {
  cancelPendingAction() {
    return Promise.resolve({ cancelled: true });
  }
  checkWeatherConditions() {
    return Promise.resolve({
      amplification: "high" as const,
      observedAt: "2026-07-19T14:00:00.000Z",
      precipitation: "heavy" as const,
      summary: "Heavy rain is reducing visibility on North Lamar.",
    });
  }
  closeIncident(input: { incidentId: string }) {
    return Promise.resolve({
      closedAt: "2026-07-19T14:40:00.000Z",
      incidentId: input.incidentId,
      status: "resolved" as const,
    });
  }
  createAlertDraft(input: {
    audience: "affected_routes" | "city_operators" | "citywide";
  }) {
    return Promise.resolve({
      alertId: randomUUID(),
      audience: input.audience,
      requiresApproval: input.audience === "citywide",
      status: "draft" as const,
    });
  }
  findAffectedTransitRoutes() {
    return Promise.resolve([
      { delayMinutes: 5, major: true, routeId: "801", routeName: "Rapid 801" },
    ]);
  }
  getIncidentSnapshot() {
    return Promise.resolve(snapshot());
  }
  publishSimulatedAlert(input: { alertId?: string | undefined }) {
    return Promise.resolve({
      alertId: input.alertId ?? randomUUID(),
      channel: "dashboard_simulation" as const,
      publishedAt: "2026-07-19T14:10:00.000Z",
    });
  }
  recordIncidentOutcome() {
    return Promise.resolve({ outcomeId: randomUUID() });
  }
  requestHumanApproval(input: { alertId?: string | undefined }) {
    return Promise.resolve({
      alertId: input.alertId ?? randomUUID(),
      status: "pending_approval" as const,
    });
  }
  retrieveSimilarIncidents() {
    return Promise.resolve([]);
  }
  reviseAlertDraft(input: {
    alertId?: string | undefined;
    audience: "affected_routes" | "city_operators" | "citywide";
  }) {
    return Promise.resolve({
      alertId: input.alertId ?? randomUUID(),
      audience: input.audience,
      requiresApproval: input.audience === "citywide",
      status: "draft" as const,
    });
  }
  scheduleIncidentRecheck(input: { afterSeconds: number; missionId: string }) {
    return Promise.resolve({
      missionId: input.missionId,
      nextWakeAt: new Date(
        Date.parse("2026-07-19T14:00:00.000Z") + input.afterSeconds * 1_000,
      ).toISOString(),
    });
  }
  storeIncidentLesson() {
    return Promise.resolve({ memoryId: randomUUID() });
  }
  updateIncidentSeverity(input: { incidentId: string; severity: number }) {
    return Promise.resolve({
      incidentId: input.incidentId,
      previousSeverity: 3,
      severity: input.severity,
    });
  }
}

function context(): ToolContext {
  return {
    affectedMajorRouteCount: 1,
    confidence: 0.78,
    incidentId,
    logger: () => undefined,
    missionId,
    missionStepId: randomUUID(),
    operations: new MockOperations(),
    securityConfidence: "confident",
    severity: 3,
  };
}

describe("Autonomous Incident Commander tool registry", () => {
  it("contains exactly the required allowlisted tools", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.names()).toEqual([
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
    expect(() => registry.resolve("run_shell")).toThrow();
  });

  it("rejects invalid tool arguments and incident scope escapes", async () => {
    const registry = createDefaultToolRegistry();
    expect(() =>
      registry.validateCall({
        arguments: { incidentId, severity: 7 },
        tool: "update_incident_severity",
      }),
    ).toThrow();
    await expect(
      registry.executeValidated(
        {
          arguments: { incidentId: randomUUID() },
          tool: "get_incident_snapshot",
        },
        context(),
      ),
    ).rejects.toThrow("escaped the active incident scope");
  });

  it("calculates obvious changes deterministically", async () => {
    const registry = createDefaultToolRegistry();
    const result = await registry.executeValidated(
      {
        arguments: {
          after: snapshot({
            affectedRoutes: ["801", "1"],
            blockedLanes: 2,
            predictedDurationMinutes: 43,
            severity: 5,
            transitDelayMinutes: 14,
          }),
          before: snapshot(),
        },
        tool: "calculate_impact_change",
      },
      context(),
    );
    expect(result).toMatchObject({
      affectedRouteCount: { delta: 1 },
      blockedLanes: { delta: 1 },
      meaningful: true,
      predictedDurationMinutes: { delta: 19 },
      severity: { delta: 2 },
      transitDelayMinutes: { delta: 9 },
    });
  });

  it("uses stable mission-scoped idempotency fingerprints", () => {
    const registry = createDefaultToolRegistry();
    const call = {
      arguments: { afterSeconds: 60, missionId },
      tool: "schedule_incident_recheck" as const,
    };
    expect(registry.fingerprint(call, context())).toBe(
      registry.fingerprint(call, context()),
    );
    expect(
      registry.fingerprint(
        { ...call, arguments: { afterSeconds: 90, missionId } },
        context(),
      ),
    ).not.toBe(registry.fingerprint(call, context()));
  });

  it("marks simulated publication and citywide drafts for approval", () => {
    const registry = createDefaultToolRegistry();
    const toolContext = context();
    expect(
      registry
        .resolve("publish_simulated_alert")
        .definition.requiresApproval(
          { alertId: randomUUID(), incidentId },
          toolContext,
        ),
    ).toBe(true);
    expect(
      registry.resolve("create_alert_draft").definition.requiresApproval(
        {
          affectedRoutes: ["801"],
          audience: "citywide",
          incidentId,
          message: "Expect significant delays near North Lamar Boulevard.",
          severity: 5,
          title: "North Lamar disruption",
        },
        toolContext,
      ),
    ).toBe(true);
  });
});
