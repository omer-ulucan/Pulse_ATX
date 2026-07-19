import { randomUUID } from "node:crypto";

import type {
  CreateMissionInput,
  MissionRecord,
  MissionRepository,
  MissionStepRecord,
  MissionStepResultInput,
  MissionTimelineEvent,
  MissionTransitionPatch,
  PersistPlanInput,
} from "./mission-repository.js";
import type { MissionStatus } from "./mission-schemas.js";

const terminalStates = new Set<MissionStatus>([
  "cancelled",
  "completed",
  "failed",
]);

const allowedTransitions: Record<MissionStatus, ReadonlySet<MissionStatus>> = {
  active: new Set([
    "active",
    "cancelled",
    "completed",
    "failed",
    "waiting",
    "waiting_approval",
  ]),
  cancelled: new Set(),
  completed: new Set(),
  failed: new Set(),
  planning: new Set(["active", "cancelled", "failed"]),
  waiting: new Set(["active", "cancelled", "completed", "failed"]),
  waiting_approval: new Set(["active", "cancelled", "failed"]),
};

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, MissionRecord>();
  private readonly steps = new Map<string, MissionStepRecord>();
  readonly timeline: MissionTimelineEvent[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  appendTimeline(event: MissionTimelineEvent): Promise<void> {
    this.timeline.push(copy(event));
    return Promise.resolve();
  }

  createMission(
    input: CreateMissionInput,
  ): Promise<{ created: boolean; mission: MissionRecord }> {
    const active = [...this.missions.values()].find(
      (mission) =>
        mission.incidentId === input.incidentId &&
        !terminalStates.has(mission.status),
    );
    if (active)
      return Promise.resolve({ created: false, mission: copy(active) });

    const now = this.now().toISOString();
    const mission: MissionRecord = {
      assumptions: [],
      completedAt: null,
      currentStep: 0,
      failureReason: null,
      goal: input.goal,
      id: randomUUID(),
      incidentId: input.incidentId,
      nextWakeAt: null,
      planVersion: 1,
      priority: input.priority,
      startedAt: now,
      status: "planning",
      successCriteria: [],
      triggerReason: copy(input.triggerReason),
      updatedAt: now,
      wakeCycle: 0,
    };
    this.missions.set(mission.id, mission);
    return Promise.resolve({ created: true, mission: copy(mission) });
  }

  getMission(missionId: string): Promise<MissionRecord | null> {
    const mission = this.missions.get(missionId);
    return Promise.resolve(mission ? copy(mission) : null);
  }

  listSteps(
    missionId: string,
    planVersion: number,
  ): Promise<MissionStepRecord[]> {
    return Promise.resolve(
      [...this.steps.values()]
        .filter(
          (step) =>
            step.missionId === missionId && step.planVersion === planVersion,
        )
        .sort((left, right) => left.stepOrder - right.stepOrder)
        .map(copy),
    );
  }

  markStepRunning(stepId: string): Promise<MissionStepRecord> {
    const step = this.requireStep(stepId);
    if (step.status !== "planned") {
      throw new Error(`Mission step ${stepId} is not planned`);
    }
    step.status = "running";
    step.startedAt = this.now().toISOString();
    return Promise.resolve(copy(step));
  }

  persistPlan(input: PersistPlanInput): Promise<MissionRecord> {
    const mission = this.requireMission(input.missionId);
    if (mission.status !== "planning" && mission.status !== "active") {
      throw new Error(
        `Mission ${mission.id} cannot persist a plan while ${mission.status}`,
      );
    }
    if (input.planVersion < 1 || input.planVersion > 3) {
      throw new Error("Mission plan version exceeds the bounded range");
    }
    if (
      [...this.steps.values()].some(
        (step) =>
          step.missionId === input.missionId &&
          step.planVersion === input.planVersion,
      )
    ) {
      throw new Error(
        `Mission plan version ${input.planVersion} already exists`,
      );
    }
    for (const planStep of input.plan.steps) {
      const step: MissionStepRecord = {
        completedAt: null,
        decisionAudit: null,
        error: null,
        id: randomUUID(),
        missionId: mission.id,
        planVersion: input.planVersion,
        rationale: planStep.rationale,
        requiresFreshObservation: planStep.requiresFreshObservation,
        result: null,
        startedAt: null,
        status: "planned",
        stepOrder: planStep.order,
        toolArguments: copy(planStep.arguments),
        toolName: planStep.tool,
      };
      this.steps.set(step.id, step);
    }
    mission.assumptions = [...input.plan.assumptions];
    mission.goal = input.plan.goal;
    mission.planVersion = input.planVersion;
    mission.priority = input.plan.priority;
    mission.status = "active";
    mission.successCriteria = [...input.plan.successCriteria];
    mission.updatedAt = this.now().toISOString();
    this.timeline.push({
      eventType: "mission_plan_created",
      incidentId: mission.incidentId,
      message: `Plan version ${input.planVersion} created`,
      metadata: {
        planVersion: input.planVersion,
        stepCount: input.plan.steps.length,
        usedFallback: input.usedFallback,
        validationFailures: input.validationFailures,
      },
      missionId: mission.id,
    });
    return Promise.resolve(copy(mission));
  }

  recordStepResult(input: MissionStepResultInput): Promise<MissionStepRecord> {
    const step = this.requireStep(input.stepId);
    if (step.status !== "running") {
      throw new Error(`Mission step ${step.id} is not running`);
    }
    step.status = input.status;
    step.completedAt = ["completed", "failed", "skipped", "cancelled"].includes(
      input.status,
    )
      ? this.now().toISOString()
      : null;
    step.decisionAudit = input.audit ? copy(input.audit) : null;
    step.error = input.error ?? null;
    step.result = input.result === undefined ? null : copy(input.result);
    return Promise.resolve(copy(step));
  }

  transitionMission(
    missionId: string,
    expected: MissionStatus | MissionStatus[],
    status: MissionStatus,
    patch: MissionTransitionPatch = {},
  ): Promise<MissionRecord> {
    const mission = this.requireMission(missionId);
    const expectedStates = Array.isArray(expected) ? expected : [expected];
    if (!expectedStates.includes(mission.status)) {
      throw new Error(
        `Mission ${mission.id} expected ${expectedStates.join("|")} but was ${mission.status}`,
      );
    }
    if (
      mission.status !== status &&
      !allowedTransitions[mission.status].has(status)
    ) {
      throw new Error(
        `Invalid mission transition ${mission.status} -> ${status}`,
      );
    }
    mission.status = status;
    if (patch.completedAt !== undefined)
      mission.completedAt = patch.completedAt;
    if (patch.currentStep !== undefined)
      mission.currentStep = patch.currentStep;
    if (patch.failureReason !== undefined)
      mission.failureReason = patch.failureReason;
    if (patch.nextWakeAt !== undefined) mission.nextWakeAt = patch.nextWakeAt;
    if (patch.wakeCycle !== undefined) mission.wakeCycle = patch.wakeCycle;
    mission.updatedAt = this.now().toISOString();
    return Promise.resolve(copy(mission));
  }

  private requireMission(missionId: string): MissionRecord {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error(`Mission ${missionId} was not found`);
    return mission;
  }

  private requireStep(stepId: string): MissionStepRecord {
    const step = this.steps.get(stepId);
    if (!step) throw new Error(`Mission step ${stepId} was not found`);
    return step;
  }
}
