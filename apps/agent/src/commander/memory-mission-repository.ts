import { randomUUID } from "node:crypto";

import type {
  CreateMissionInput,
  MissionRecord,
  MissionObservationRecord,
  MissionRuntimeRepository,
  MissionStepRecord,
  MissionStepResultInput,
  MissionTimelineEvent,
  MissionTransitionPatch,
  PersistPlanInput,
  ToolExecutionRecord,
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

export class MemoryMissionRepository implements MissionRuntimeRepository {
  private readonly missions = new Map<string, MissionRecord>();
  private readonly observations = new Map<string, MissionObservationRecord>();
  private readonly steps = new Map<string, MissionStepRecord>();
  private readonly executions = new Map<string, ToolExecutionRecord>();
  private readonly claims = new Map<
    string,
    { expiresAt: number; workerId: string }
  >();
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

  getLatestObservation(
    missionId: string,
  ): Promise<MissionObservationRecord | null> {
    const observation = [...this.observations.values()]
      .filter((item) => item.missionId === missionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return Promise.resolve(observation ? copy(observation) : null);
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

  listToolExecutions(missionId: string): ToolExecutionRecord[] {
    return [...this.executions.values()]
      .filter((execution) => execution.missionId === missionId)
      .map(copy);
  }

  markStepRunning(stepId: string): Promise<MissionStepRecord> {
    const step = this.requireStep(stepId);
    if (!["planned", "waiting", "waiting_approval"].includes(step.status)) {
      throw new Error(`Mission step ${stepId} is not runnable`);
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
    if (input.planVersion > mission.planVersion) {
      for (const priorStep of this.steps.values()) {
        if (
          priorStep.missionId === mission.id &&
          priorStep.planVersion === mission.planVersion &&
          ["planned", "waiting"].includes(priorStep.status)
        ) {
          priorStep.status = "cancelled";
          priorStep.completedAt = this.now().toISOString();
        }
      }
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

  recordObservation(input: {
    changeSummary: MissionObservationRecord["changeSummary"];
    incidentId: string;
    missionId: string;
    observationType: string;
    stateFingerprint: string;
    stateSnapshot: MissionObservationRecord["stateSnapshot"];
  }): Promise<MissionObservationRecord> {
    const key = `${input.missionId}:${input.stateFingerprint}`;
    const existing = this.observations.get(key);
    if (existing) return Promise.resolve(copy(existing));
    const observation: MissionObservationRecord = {
      ...copy(input),
      createdAt: this.now().toISOString(),
      id: randomUUID(),
    };
    this.observations.set(key, observation);
    return Promise.resolve(copy(observation));
  }

  beginToolExecution(input: {
    approvalRequired: boolean;
    arguments: Record<string, unknown>;
    argumentsFingerprint: string;
    missionId: string;
    missionStepId: string;
    securityStatus: string;
    toolName: ToolExecutionRecord["toolName"];
  }): Promise<ToolExecutionRecord> {
    const existing = [...this.executions.values()].find(
      (execution) =>
        execution.missionId === input.missionId &&
        execution.toolName === input.toolName &&
        execution.argumentsFingerprint === input.argumentsFingerprint,
    );
    if (existing) return Promise.resolve(copy(existing));
    const execution: ToolExecutionRecord = {
      approvalAlertId: null,
      approvalStatus: input.approvalRequired ? "pending" : "not_required",
      arguments: copy(input.arguments),
      argumentsFingerprint: input.argumentsFingerprint,
      completedAt: null,
      error: null,
      id: randomUUID(),
      latencyMs: null,
      missionId: input.missionId,
      missionStepId: input.missionStepId,
      result: null,
      securityStatus: input.securityStatus,
      startedAt: null,
      status: input.approvalRequired ? "blocked" : "pending",
      toolName: input.toolName,
    };
    this.executions.set(execution.id, execution);
    return Promise.resolve(copy(execution));
  }

  claimMissions(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<MissionRecord[]> {
    const now = this.now().getTime();
    const candidates = [...this.missions.values()]
      .filter((mission) => {
        const claim = this.claims.get(mission.id);
        if (claim && claim.expiresAt >= now) return false;
        if (["planning", "active"].includes(mission.status)) return true;
        if (
          mission.status === "waiting" &&
          mission.nextWakeAt &&
          Date.parse(mission.nextWakeAt) <= now
        ) {
          return true;
        }
        if (mission.status === "waiting_approval") {
          return [...this.executions.values()].some(
            (execution) =>
              execution.missionId === mission.id &&
              ["approved", "rejected"].includes(execution.approvalStatus ?? ""),
          );
        }
        return false;
      })
      .sort((left, right) => right.priority - left.priority)
      .slice(0, limit);
    for (const mission of candidates) {
      this.claims.set(mission.id, {
        expiresAt: now + leaseSeconds * 1_000,
        workerId,
      });
    }
    return Promise.resolve(candidates.map(copy));
  }

  decideToolApproval(
    executionId: string,
    operator: string,
    approved: boolean,
  ): Promise<ToolExecutionRecord> {
    if (operator.trim().length < 2)
      throw new Error("Operator identity is required");
    const execution = this.requireExecution(executionId);
    if (execution.approvalStatus === "pending") {
      execution.approvalStatus = approved ? "approved" : "rejected";
    }
    return Promise.resolve(copy(execution));
  }

  finishToolExecution(input: {
    error: string | null;
    executionId: string;
    latencyMs: number;
    result: unknown;
    securityStatus: string;
    status: "blocked" | "completed" | "failed";
  }): Promise<ToolExecutionRecord> {
    const execution = this.requireExecution(input.executionId);
    execution.completedAt = this.now().toISOString();
    execution.error = input.error;
    execution.latencyMs = input.latencyMs;
    execution.result = copy(input.result);
    execution.securityStatus = input.securityStatus;
    execution.startedAt ??= this.now().toISOString();
    execution.status = input.status;
    return Promise.resolve(copy(execution));
  }

  getMissionApprovalDecision(
    missionId: string,
  ): Promise<"approved" | "pending" | "rejected" | null> {
    const execution = [...this.executions.values()]
      .filter(
        (item) => item.missionId === missionId && item.approvalStatus !== null,
      )
      .at(-1);
    return Promise.resolve(
      execution?.approvalStatus === "not_required"
        ? null
        : (execution?.approvalStatus ?? null),
    );
  }

  markToolExecutionRunning(executionId: string): Promise<ToolExecutionRecord> {
    const execution = this.requireExecution(executionId);
    execution.status = "running";
    execution.startedAt = this.now().toISOString();
    return Promise.resolve(copy(execution));
  }

  releaseClaim(missionId: string, workerId: string): Promise<void> {
    const claim = this.claims.get(missionId);
    if (claim?.workerId === workerId) this.claims.delete(missionId);
    return Promise.resolve();
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

  private requireExecution(executionId: string): ToolExecutionRecord {
    const execution = this.executions.get(executionId);
    if (!execution)
      throw new Error(`Tool execution ${executionId} was not found`);
    return execution;
  }
}
