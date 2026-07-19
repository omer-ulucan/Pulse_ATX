import type { CounterfactualAudit, MissionPlan } from "./mission-schemas.js";
import type {
  MissionRecord,
  MissionRepository,
  MissionStepRecord,
} from "./mission-repository.js";
import type { MissionPlanner } from "./mission-planner.js";
import type { AgentToolRegistry } from "./tools/registry.js";
import type { IncidentSnapshot } from "./tools/types.js";
import { createFingerprint } from "../lib/fingerprint.js";

export interface MissionContextProvider {
  getIncidentSnapshot(
    incidentId: string,
    signal?: AbortSignal,
  ): Promise<IncidentSnapshot>;
  getRelevantLessons(
    snapshot: IncidentSnapshot,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]>;
}

export interface MissionToolExecutionRequest {
  audit: CounterfactualAudit | null;
  mission: MissionRecord;
  signal?: AbortSignal | undefined;
  snapshot: IncidentSnapshot;
  step: MissionStepRecord;
}

export type MissionToolExecutionOutcome =
  | { reason: string; result?: unknown; status: "cancelled" }
  | { result: unknown; status: "completed" }
  | { nextWakeAt: string; result: unknown; status: "waiting" }
  | { result: unknown; status: "waiting_approval" }
  | { error: string; result?: unknown; status: "failed" };

export interface MissionToolRunner {
  execute(
    request: MissionToolExecutionRequest,
  ): Promise<MissionToolExecutionOutcome>;
}

export interface MissionEngineOptions {
  maxMissionLifetimeMs?: number | undefined;
  maxToolExecutionsPerWake?: number | undefined;
  now?: (() => Date) | undefined;
}

export interface MissionWakeResult {
  executions: number;
  mission: MissionRecord;
}

function toolCompletionEvent(
  toolName: MissionStepRecord["toolName"],
  result: unknown,
): { eventType: string; message: string } {
  const messages: Partial<
    Record<MissionStepRecord["toolName"], [string, string]>
  > = {
    cancel_pending_action: [
      "mission_pending_action_cancelled",
      "Pending escalation action cancelled",
    ],
    check_weather_conditions: [
      "mission_weather_checked",
      "Weather amplification confirmed",
    ],
    close_incident: ["mission_incident_closed", "Incident closed"],
    create_alert_draft: ["mission_alert_drafted", "Alert draft created"],
    find_affected_transit_routes: [
      "mission_transit_checked",
      "Transit routes checked",
    ],
    publish_simulated_alert: [
      "mission_alert_published",
      "Alert published in simulation",
    ],
    record_incident_outcome: ["mission_outcome_recorded", "Outcome recorded"],
    request_human_approval: [
      "mission_approval_boundary_created",
      "Human approval boundary created",
    ],
    retrieve_similar_incidents: [
      "mission_history_retrieved",
      "Historical incidents retrieved",
    ],
    revise_alert_draft: ["mission_alert_revised", "Alert draft revised"],
    store_incident_lesson: ["mission_lesson_stored", "Lesson stored"],
  };
  if (
    toolName === "update_incident_severity" &&
    typeof result === "object" &&
    result !== null &&
    "previousSeverity" in result &&
    "severity" in result &&
    typeof result.previousSeverity === "number" &&
    typeof result.severity === "number"
  ) {
    const direction =
      result.severity > result.previousSeverity
        ? "raised"
        : result.severity < result.previousSeverity
          ? "lowered"
          : "confirmed";
    return {
      eventType: `mission_severity_${direction}`,
      message: `Severity ${direction} from ${result.previousSeverity} to ${result.severity}`,
    };
  }
  const event = messages[toolName];
  return event
    ? { eventType: event[0], message: event[1] }
    : {
        eventType: "mission_tool_completed",
        message: `${toolName} completed`,
      };
}

function planFromRecords(
  mission: MissionRecord,
  steps: MissionStepRecord[],
): MissionPlan {
  const schedule = steps.find(
    (step) => step.toolName === "schedule_incident_recheck",
  );
  const afterSeconds =
    typeof schedule?.toolArguments.afterSeconds === "number"
      ? schedule.toolArguments.afterSeconds
      : 60;
  return {
    assumptions: mission.assumptions,
    goal: mission.goal,
    priority: mission.priority,
    recheckAfterSeconds: afterSeconds,
    steps: steps.map((step) => ({
      arguments: step.toolArguments,
      order: step.stepOrder,
      rationale: step.rationale,
      requiresFreshObservation: step.requiresFreshObservation,
      tool: step.toolName,
    })),
    successCriteria: mission.successCriteria,
  };
}

export class MissionExecutionEngine {
  private readonly maxMissionLifetimeMs: number;
  private readonly maxToolExecutionsPerWake: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: MissionRepository,
    private readonly planner: MissionPlanner,
    private readonly registry: AgentToolRegistry,
    private readonly contextProvider: MissionContextProvider,
    private readonly toolRunner: MissionToolRunner,
    options: MissionEngineOptions = {},
  ) {
    this.maxMissionLifetimeMs = options.maxMissionLifetimeMs ?? 4 * 60 * 60_000;
    this.maxToolExecutionsPerWake = Math.min(
      options.maxToolExecutionsPerWake ?? 12,
      12,
    );
    this.now = options.now ?? (() => new Date());
  }

  async processMission(
    missionId: string,
    signal?: AbortSignal,
  ): Promise<MissionWakeResult> {
    let mission = await this.requireMission(missionId);
    if (["cancelled", "completed", "failed"].includes(mission.status)) {
      return { executions: 0, mission };
    }
    if (
      this.now().getTime() - Date.parse(mission.startedAt) >
      this.maxMissionLifetimeMs
    ) {
      mission = await this.failMission(
        mission,
        "Maximum configured mission lifetime exceeded",
      );
      return { executions: 0, mission };
    }
    if (mission.status === "waiting" || mission.status === "waiting_approval") {
      return { executions: 0, mission };
    }

    let snapshot = await this.contextProvider.getIncidentSnapshot(
      mission.incidentId,
      signal,
    );
    if (mission.status === "planning") {
      try {
        await this.repository.recordObservation({
          changeSummary: {},
          incidentId: mission.incidentId,
          missionId: mission.id,
          observationType: "initial",
          stateFingerprint: createFingerprint(snapshot),
          stateSnapshot: snapshot,
        });
        const relevantLessons = await this.contextProvider.getRelevantLessons(
          snapshot,
          signal,
        );
        const planResult = await this.planner.createPlan(
          {
            incidentSnapshot: snapshot,
            missionId: mission.id,
            relevantLessons,
            triggerReason: mission.triggerReason,
          },
          signal,
        );
        mission = await this.repository.persistPlan({
          missionId: mission.id,
          plan: planResult.plan,
          planVersion: mission.planVersion,
          usedFallback: planResult.usedFallback,
          validationFailures: planResult.validationFailures,
        });
        await this.repository.appendTimeline({
          eventType: "mission_goal_established",
          incidentId: mission.incidentId,
          message: "Goal established",
          metadata: {
            goal: mission.goal,
            priority: mission.priority,
            promptVersion: planResult.promptVersion,
          },
          missionId: mission.id,
        });
      } catch (error) {
        mission = await this.failMission(
          mission,
          error instanceof Error ? error.message : "Mission planning failed",
        );
        return { executions: 0, mission };
      }
    }

    const steps = await this.repository.listSteps(
      mission.id,
      mission.planVersion,
    );
    let executions = 0;
    for (const plannedStep of steps) {
      if (
        plannedStep.status !== "planned" &&
        plannedStep.status !== "waiting_approval"
      )
        continue;
      if (executions >= this.maxToolExecutionsPerWake) {
        const nextWakeAt = new Date(
          this.now().getTime() + 15_000,
        ).toISOString();
        mission = await this.repository.transitionMission(
          mission.id,
          "active",
          "waiting",
          { nextWakeAt },
        );
        await this.repository.appendTimeline({
          eventType: "mission_execution_budget_exhausted",
          incidentId: mission.incidentId,
          message:
            "Wake-cycle execution budget reached; continuation scheduled",
          metadata: { executions, nextWakeAt },
          missionId: mission.id,
        });
        return { executions, mission };
      }

      if (plannedStep.requiresFreshObservation) {
        snapshot = await this.contextProvider.getIncidentSnapshot(
          mission.incidentId,
          signal,
        );
      }
      if (plannedStep.status === "planned") {
        await this.repository.appendTimeline({
          eventType: "mission_tool_proposed",
          incidentId: mission.incidentId,
          message: "Tool call proposed",
          metadata: {
            planVersion: mission.planVersion,
            stepOrder: plannedStep.stepOrder,
            toolName: plannedStep.toolName,
          },
          missionId: mission.id,
        });
      }
      const runningStep = await this.repository.markStepRunning(plannedStep.id);
      const definition = this.registry.resolve(runningStep.toolName).definition;
      let audit: CounterfactualAudit | null = runningStep.decisionAudit;
      if (definition.securityPolicy.impact === "high" && !audit) {
        const auditResult = await this.planner.auditAction(
          {
            incidentSnapshot: snapshot,
            step: {
              arguments: runningStep.toolArguments,
              order: runningStep.stepOrder,
              rationale: runningStep.rationale,
              requiresFreshObservation: runningStep.requiresFreshObservation,
              tool: runningStep.toolName,
            },
          },
          signal,
        );
        audit = auditResult.audit;
      }

      let outcome: MissionToolExecutionOutcome;
      try {
        outcome = await this.toolRunner.execute({
          audit,
          mission,
          signal,
          snapshot,
          step: runningStep,
        });
      } catch (error) {
        outcome = {
          error:
            error instanceof Error
              ? error.message
              : "Unknown tool execution failure",
          status: "failed",
        };
      }
      executions += 1;

      if (outcome.status === "completed") {
        await this.repository.recordStepResult({
          audit,
          result: outcome.result,
          status: "completed",
          stepId: runningStep.id,
        });
        mission = await this.repository.transitionMission(
          mission.id,
          "active",
          "active",
          { currentStep: runningStep.stepOrder },
        );
        const completionEvent = toolCompletionEvent(
          runningStep.toolName,
          outcome.result,
        );
        await this.repository.appendTimeline({
          eventType: completionEvent.eventType,
          incidentId: mission.incidentId,
          message: completionEvent.message,
          metadata: {
            planVersion: mission.planVersion,
            stepOrder: runningStep.stepOrder,
            toolName: runningStep.toolName,
          },
          missionId: mission.id,
        });
        continue;
      }

      if (outcome.status === "waiting") {
        await this.repository.recordStepResult({
          audit,
          result: outcome.result,
          status: "waiting",
          stepId: runningStep.id,
        });
        mission = await this.repository.transitionMission(
          mission.id,
          "active",
          "waiting",
          {
            currentStep: runningStep.stepOrder,
            nextWakeAt: outcome.nextWakeAt,
          },
        );
        await this.repository.appendTimeline({
          eventType: "mission_recheck_scheduled",
          incidentId: mission.incidentId,
          message: "Recheck scheduled",
          metadata: { nextWakeAt: outcome.nextWakeAt },
          missionId: mission.id,
        });
        return { executions, mission };
      }

      if (outcome.status === "waiting_approval") {
        await this.repository.recordStepResult({
          audit,
          result: outcome.result,
          status: "waiting_approval",
          stepId: runningStep.id,
        });
        mission = await this.repository.transitionMission(
          mission.id,
          "active",
          "waiting_approval",
          { currentStep: runningStep.stepOrder, nextWakeAt: null },
        );
        await this.repository.appendTimeline({
          eventType: "mission_approval_requested",
          incidentId: mission.incidentId,
          message: "Human approval requested",
          metadata: { stepOrder: runningStep.stepOrder },
          missionId: mission.id,
        });
        return { executions, mission };
      }

      if (outcome.status === "cancelled") {
        await this.repository.recordStepResult({
          audit,
          error: outcome.reason,
          result: outcome.result,
          status: "cancelled",
          stepId: runningStep.id,
        });
        mission = await this.repository.transitionMission(
          mission.id,
          "active",
          "cancelled",
          {
            completedAt: this.now().toISOString(),
            failureReason: outcome.reason,
          },
        );
        await this.repository.appendTimeline({
          eventType: "mission_cancelled",
          incidentId: mission.incidentId,
          message: "Mission cancelled at the human approval boundary",
          metadata: { reason: outcome.reason },
          missionId: mission.id,
        });
        return { executions, mission };
      }

      await this.repository.recordStepResult({
        audit,
        error: outcome.error,
        result: outcome.result,
        status: "failed",
        stepId: runningStep.id,
      });
      mission = await this.failMission(mission, outcome.error);
      return { executions, mission };
    }

    const terminalTools = new Set(steps.map((step) => step.toolName));
    const finalStatus = terminalTools.has("close_incident")
      ? "completed"
      : "waiting";
    const scheduleStep = steps.find(
      (step) => step.toolName === "schedule_incident_recheck",
    );
    const afterSeconds =
      typeof scheduleStep?.toolArguments.afterSeconds === "number"
        ? scheduleStep.toolArguments.afterSeconds
        : 60;
    mission = await this.repository.transitionMission(
      mission.id,
      "active",
      finalStatus,
      {
        completedAt:
          finalStatus === "completed" ? this.now().toISOString() : null,
        nextWakeAt:
          finalStatus === "waiting"
            ? new Date(
                this.now().getTime() + afterSeconds * 1_000,
              ).toISOString()
            : null,
      },
    );
    if (finalStatus === "completed") {
      await this.repository.appendTimeline({
        eventType: "mission_completed",
        incidentId: mission.incidentId,
        message: "Mission completed",
        metadata: { planVersion: mission.planVersion },
        missionId: mission.id,
      });
    }
    return { executions, mission };
  }

  private async failMission(
    mission: MissionRecord,
    reason: string,
  ): Promise<MissionRecord> {
    const failed = await this.repository.transitionMission(
      mission.id,
      ["planning", "active", "waiting", "waiting_approval"],
      "failed",
      { completedAt: this.now().toISOString(), failureReason: reason },
    );
    await this.repository.appendTimeline({
      eventType: "mission_failed",
      incidentId: failed.incidentId,
      message: "Mission failed safely",
      metadata: { reason },
      missionId: failed.id,
    });
    return failed;
  }

  private async requireMission(missionId: string): Promise<MissionRecord> {
    const mission = await this.repository.getMission(missionId);
    if (!mission) throw new Error(`Mission ${missionId} was not found`);
    return mission;
  }
}

export { planFromRecords };
