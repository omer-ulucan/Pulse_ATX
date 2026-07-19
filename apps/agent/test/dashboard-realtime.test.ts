import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DashboardMissionSchema,
  DashboardMissionStepSchema,
  DashboardObservationSchema,
  DashboardToolExecutionSchema,
} from "../../web/src/lib/dashboard-data.js";

describe("Incident Commander Realtime payload validation", () => {
  it("accepts the persisted mission lifecycle payloads", () => {
    const missionId = randomUUID();
    const incidentId = randomUUID();
    const stepId = randomUUID();
    const timestamp = "2026-07-19T14:01:00.000Z";

    expect(
      DashboardMissionSchema.parse({
        completed_at: null,
        current_step: 4,
        failure_reason: null,
        goal: "Minimize commuter disruption around North Lamar Boulevard.",
        id: missionId,
        incident_id: incidentId,
        next_wake_at: null,
        plan_version: 2,
        priority: 5,
        started_at: timestamp,
        status: "waiting_approval",
        success_criteria: ["Observe recovery before closure."],
        trigger_reason: { severityAtLeast3: true },
        updated_at: timestamp,
        wake_cycle: 1,
      }),
    ).toMatchObject({ plan_version: 2, status: "waiting_approval" });

    expect(
      DashboardMissionStepSchema.parse({
        completed_at: null,
        created_at: timestamp,
        decision_audit: {
          alternatives: [
            {
              confidence: 0.82,
              expectedBenefit: "Avoid unnecessary publication.",
              expectedRisk: "Riders receive no warning.",
              name: "No action",
              reversibility: "high",
            },
            {
              confidence: 0.76,
              expectedBenefit: "Adds one live observation.",
              expectedRisk: "Warning is delayed.",
              name: "Delayed action",
              reversibility: "high",
            },
          ],
          selectedAction: "Publish targeted Route 801 alert.",
          selectionReason: "Verified disruption warrants targeted notice.",
        },
        error: null,
        id: stepId,
        mission_id: missionId,
        plan_version: 2,
        rationale: "Publish only after operator approval.",
        result: { executionId: randomUUID() },
        status: "waiting_approval",
        step_order: 4,
        tool_arguments: { incidentId },
        tool_name: "publish_simulated_alert",
      }),
    ).toMatchObject({ status: "waiting_approval", step_order: 4 });

    expect(
      DashboardObservationSchema.parse({
        change_summary: {
          blockedLanes: { after: 2, before: 1, delta: 1 },
          severity: { after: 5, before: 3, delta: 2 },
        },
        created_at: timestamp,
        id: randomUUID(),
        incident_id: incidentId,
        mission_id: missionId,
        observation_type: "scheduled_recheck",
        state_fingerprint: "deterministic-fingerprint",
        state_snapshot: {
          affectedRoutes: ["801", "1"],
          blockedLanes: 2,
          confidence: 0.82,
          correlatedFeedCount: 3,
          geographicSpreadKm: 1.1,
          incidentId,
          predictedDurationMinutes: 43,
          severity: 5,
          status: "active",
          transitDelayMinutes: 14,
          updatedAt: timestamp,
          weatherSeverity: "heavy_rain",
        },
      }),
    ).toMatchObject({ state_snapshot: { severity: 5 } });

    expect(
      DashboardToolExecutionSchema.parse({
        approval_alert_id: randomUUID(),
        approval_status: "pending",
        arguments: { audience: "affected_routes", incidentId },
        completed_at: null,
        created_at: timestamp,
        error: null,
        id: randomUUID(),
        mission_id: missionId,
        mission_step_id: stepId,
        result: null,
        security_status: "hiddenlayer_passed",
        status: "blocked",
        tool_name: "publish_simulated_alert",
      }),
    ).toMatchObject({ approval_status: "pending", status: "blocked" });
  });

  it("rejects an unbounded or malformed Realtime mission payload", () => {
    expect(() =>
      DashboardMissionSchema.parse({
        id: randomUUID(),
        plan_version: 9,
        status: "recursing_forever",
      }),
    ).toThrow();
  });
});
