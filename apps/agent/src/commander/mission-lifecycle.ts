import { mapBounded } from "@pulse-atx/shared";

import { createFingerprint } from "../lib/fingerprint.js";
import type {
  MissionContextProvider,
  MissionExecutionEngine,
} from "./mission-engine.js";
import { planFromRecords } from "./mission-engine.js";
import type { MissionPlanner } from "./mission-planner.js";
import type {
  MissionRecord,
  MissionRuntimeRepository,
} from "./mission-repository.js";
import { MissionPlanSchema, type MissionPlan } from "./mission-schemas.js";
import { evaluateMissionTrigger } from "./mission-trigger.js";
import { compareIncidentSnapshots } from "./tools/change-detector.js";
import type { IncidentSnapshot } from "./tools/types.js";

export interface MissionCandidateProvider extends MissionContextProvider {
  listMissionCandidates(
    limit: number,
    signal?: AbortSignal,
  ): Promise<IncidentSnapshot[]>;
}

export interface MissionLifecycleOptions {
  claimLimit?: number | undefined;
  concurrency?: number | undefined;
  leaseSeconds?: number | undefined;
  now?: (() => Date) | undefined;
  workerId: string;
}

export interface MissionBatchSummary {
  cancelled: number;
  claimed: number;
  completed: number;
  discovered: number;
  failed: number;
  waiting: number;
}

export class MissionLifecycleCoordinator {
  private readonly claimLimit: number;
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: MissionRuntimeRepository,
    private readonly planner: MissionPlanner,
    private readonly engine: MissionExecutionEngine,
    private readonly contextProvider: MissionCandidateProvider,
    private readonly options: MissionLifecycleOptions,
  ) {
    this.claimLimit = Math.min(options.claimLimit ?? 4, 12);
    this.concurrency = Math.min(options.concurrency ?? 2, 4);
    this.leaseSeconds = Math.min(Math.max(options.leaseSeconds ?? 60, 15), 300);
    this.now = options.now ?? (() => new Date());
  }

  async processBatch(signal?: AbortSignal): Promise<MissionBatchSummary> {
    const discovered = await this.discoverMissions(signal);
    const claimed = await this.repository.claimMissions(
      this.options.workerId,
      this.claimLimit,
      this.leaseSeconds,
    );
    const missions = await mapBounded(
      claimed,
      this.concurrency,
      async (mission) => {
        try {
          return await this.processClaimedMission(mission, signal);
        } finally {
          await this.repository.releaseClaim(mission.id, this.options.workerId);
        }
      },
    );
    return {
      cancelled: missions.filter((mission) => mission.status === "cancelled")
        .length,
      claimed: claimed.length,
      completed: missions.filter((mission) => mission.status === "completed")
        .length,
      discovered,
      failed: missions.filter((mission) => mission.status === "failed").length,
      waiting: missions.filter((mission) =>
        ["waiting", "waiting_approval"].includes(mission.status),
      ).length,
    };
  }

  private async discoverMissions(signal?: AbortSignal): Promise<number> {
    const snapshots = await this.contextProvider.listMissionCandidates(
      this.claimLimit * 2,
      signal,
    );
    let discovered = 0;
    for (const snapshot of snapshots) {
      const trigger = evaluateMissionTrigger({ snapshot });
      if (!trigger.qualifies) continue;
      const creation = await this.repository.createMission({
        goal: trigger.goal,
        incidentId: snapshot.incidentId,
        priority: trigger.priority,
        triggerReason: trigger.reason,
      });
      if (creation.created) {
        discovered += 1;
        await this.repository.appendTimeline({
          eventType: "mission_created",
          incidentId: snapshot.incidentId,
          message: "Mission created",
          metadata: { triggerReason: trigger.reason },
          missionId: creation.mission.id,
        });
      }
    }
    return discovered;
  }

  private async processClaimedMission(
    claimedMission: MissionRecord,
    signal?: AbortSignal,
  ): Promise<MissionRecord> {
    if (claimedMission.status === "waiting_approval") {
      const decision = await this.repository.getMissionApprovalDecision(
        claimedMission.id,
      );
      if (decision === "rejected") {
        const cancelled = await this.repository.transitionMission(
          claimedMission.id,
          "waiting_approval",
          "cancelled",
          {
            completedAt: this.now().toISOString(),
            failureReason: "Operator rejected the protected mission action",
          },
        );
        await this.repository.appendTimeline({
          eventType: "mission_cancelled",
          incidentId: cancelled.incidentId,
          message: "Mission cancelled after operator rejection",
          metadata: { wakeCycle: cancelled.wakeCycle },
          missionId: cancelled.id,
        });
        return cancelled;
      }
      if (decision !== "approved") return claimedMission;
      const resumed = await this.repository.transitionMission(
        claimedMission.id,
        "waiting_approval",
        "active",
      );
      await this.repository.appendTimeline({
        eventType: "mission_resumed_after_approval",
        incidentId: resumed.incidentId,
        message: "Approved mission action resumed",
        metadata: { wakeCycle: resumed.wakeCycle },
        missionId: resumed.id,
      });
      return (await this.engine.processMission(resumed.id, signal)).mission;
    }

    if (claimedMission.status === "waiting") {
      return this.reobserveMission(claimedMission, signal);
    }
    return (await this.engine.processMission(claimedMission.id, signal))
      .mission;
  }

  private async reobserveMission(
    mission: MissionRecord,
    signal?: AbortSignal,
  ): Promise<MissionRecord> {
    const priorObservation = await this.repository.getLatestObservation(
      mission.id,
    );
    const currentSnapshot = await this.contextProvider.getIncidentSnapshot(
      mission.incidentId,
      signal,
    );
    const priorSnapshot = priorObservation?.stateSnapshot ?? currentSnapshot;
    const changeSummary = compareIncidentSnapshots(
      priorSnapshot,
      currentSnapshot,
    );
    const wakeCycle = mission.wakeCycle + 1;
    await this.repository.recordObservation({
      changeSummary,
      incidentId: mission.incidentId,
      missionId: mission.id,
      observationType: "scheduled_recheck",
      stateFingerprint: createFingerprint(currentSnapshot),
      stateSnapshot: currentSnapshot,
    });
    let activeMission = await this.repository.transitionMission(
      mission.id,
      "waiting",
      "active",
      { nextWakeAt: null, wakeCycle },
    );
    await this.repository.appendTimeline({
      eventType: "mission_woke",
      incidentId: mission.incidentId,
      message: "Agent woke for re-evaluation",
      metadata: { changeSummary, wakeCycle },
      missionId: mission.id,
    });
    if (changeSummary.meaningful) {
      await this.repository.appendTimeline({
        eventType: "mission_conditions_changed",
        incidentId: mission.incidentId,
        message:
          changeSummary.severity.delta > 0
            ? "Live conditions worsened"
            : "Live conditions changed materially",
        metadata: { changeSummary, wakeCycle },
        missionId: mission.id,
      });
    }

    const steps = await this.repository.listSteps(
      mission.id,
      mission.planVersion,
    );
    const currentPlan = planFromRecords(mission, steps);
    const revisionResult = await this.planner.revisePlan(
      {
        changeSummary,
        currentPlan,
        currentSnapshot,
        priorSnapshot,
      },
      signal,
    );
    const { revision } = revisionResult;
    await this.repository.appendTimeline({
      eventType: "mission_revision_decision",
      incidentId: mission.incidentId,
      message: `Mission decision: ${revision.decision}`,
      metadata: {
        decision: revision.decision,
        explanation: revision.explanation,
        usedFallback: revisionResult.usedFallback,
        wakeCycle,
      },
      missionId: mission.id,
    });

    if (revision.decision === "cancel") {
      return this.repository.transitionMission(
        mission.id,
        "active",
        "cancelled",
        {
          completedAt: this.now().toISOString(),
          failureReason: revision.explanation,
        },
      );
    }
    if (revision.decision === "complete") {
      return this.repository.transitionMission(
        mission.id,
        "active",
        "completed",
        { completedAt: this.now().toISOString() },
      );
    }

    if (revision.decision === "continue" || !changeSummary.meaningful) {
      const afterSeconds =
        revision.recheckAfterSeconds ?? currentPlan.recheckAfterSeconds;
      return this.repository.transitionMission(
        mission.id,
        "active",
        "waiting",
        {
          nextWakeAt: new Date(
            this.now().getTime() + afterSeconds * 1_000,
          ).toISOString(),
        },
      );
    }

    if (mission.planVersion >= 3) {
      await this.repository.appendTimeline({
        eventType: "mission_revision_limit_reached",
        incidentId: mission.incidentId,
        message: "Plan revision limit reached; bounded monitoring continues",
        metadata: { planVersion: mission.planVersion },
        missionId: mission.id,
      });
      return this.repository.transitionMission(
        mission.id,
        "active",
        "waiting",
        {
          nextWakeAt: new Date(
            this.now().getTime() + (revision.recheckAfterSeconds ?? 60) * 1_000,
          ).toISOString(),
        },
      );
    }

    const replacementPlan = this.replacementPlan(
      activeMission,
      currentSnapshot,
      revision,
    );
    activeMission = await this.repository.persistPlan({
      missionId: mission.id,
      plan: replacementPlan,
      planVersion: mission.planVersion + 1,
      usedFallback: revisionResult.usedFallback,
      validationFailures: revisionResult.validationFailures,
    });
    return (await this.engine.processMission(activeMission.id, signal)).mission;
  }

  private replacementPlan(
    mission: MissionRecord,
    snapshot: IncidentSnapshot,
    revision: Awaited<ReturnType<MissionPlanner["revisePlan"]>>["revision"],
  ): MissionPlan {
    const recheckAfterSeconds = revision.recheckAfterSeconds ?? 60;
    if (revision.replacementSteps) {
      return MissionPlanSchema.parse({
        assumptions: mission.assumptions,
        goal: revision.revisedGoal ?? mission.goal,
        priority: revision.newSeverity ?? snapshot.severity,
        recheckAfterSeconds,
        steps: revision.replacementSteps,
        successCriteria: mission.successCriteria,
      });
    }

    const targetSeverity = revision.newSeverity ?? snapshot.severity;
    const steps: MissionPlan["steps"] = [];
    if (
      targetSeverity !== snapshot.severity ||
      revision.decision === "escalate"
    ) {
      steps.push({
        arguments: {
          incidentId: mission.incidentId,
          reason: revision.explanation,
          severity: targetSeverity,
        },
        order: steps.length + 1,
        rationale: "Persist the evidence-backed severity revision.",
        requiresFreshObservation: false,
        tool: "update_incident_severity",
      });
    }
    if (revision.decision === "escalate") {
      const affectedRoutes = snapshot.affectedRoutes;
      const routeLabel = affectedRoutes.length
        ? affectedRoutes.join(", ")
        : "the affected corridor";
      steps.push(
        {
          arguments: {
            affectedRoutes,
            audience: "affected_routes",
            incidentId: mission.incidentId,
            message: `Collision impacts have increased near ${routeLabel}. Expect approximately ${snapshot.predictedDurationMinutes} minutes of disruption while crews respond.`,
            severity: targetSeverity,
            title: "North Lamar disruption has increased",
          },
          order: steps.length + 1,
          rationale:
            "Revise the targeted commuter alert with fresh impact data.",
          requiresFreshObservation: false,
          tool: "revise_alert_draft",
        },
        {
          arguments: {
            audience: "affected_routes",
            impact: `${affectedRoutes.length} transit route(s) and ${snapshot.blockedLanes} blocked lane(s)`,
            incidentId: mission.incidentId,
            rationale: revision.explanation,
            summary: "Publish the revised targeted commuter disruption alert.",
          },
          order: steps.length + 2,
          rationale: "Create the explicit operator approval boundary.",
          requiresFreshObservation: false,
          tool: "request_human_approval",
        },
        {
          arguments: { incidentId: mission.incidentId },
          order: steps.length + 3,
          rationale:
            "Publish only after an operator approves the protected action.",
          requiresFreshObservation: false,
          tool: "publish_simulated_alert",
        },
      );
    } else if (revision.decision === "deescalate") {
      steps.push({
        arguments: {
          missionId: mission.id,
          reason: "Fresh conditions no longer support the pending escalation.",
        },
        order: steps.length + 1,
        rationale:
          "Cancel escalation actions invalidated by recovery evidence.",
        requiresFreshObservation: false,
        tool: "cancel_pending_action",
      });
    }
    steps.push({
      arguments: { afterSeconds: recheckAfterSeconds, missionId: mission.id },
      order: steps.length + 1,
      rationale: "Run another bounded live observation cycle.",
      requiresFreshObservation: false,
      tool: "schedule_incident_recheck",
    });
    return MissionPlanSchema.parse({
      assumptions: mission.assumptions,
      goal: revision.revisedGoal ?? mission.goal,
      priority: targetSeverity,
      recheckAfterSeconds,
      steps,
      successCriteria: mission.successCriteria,
    });
  }
}
