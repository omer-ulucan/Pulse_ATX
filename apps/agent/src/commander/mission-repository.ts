import type {
  CounterfactualAudit,
  MissionPlan,
  MissionStatus,
  MissionStepStatus,
} from "./mission-schemas.js";
import type {
  ImpactChange,
  IncidentSnapshot,
  ToolName,
} from "./tools/types.js";

export interface MissionRecord {
  assumptions: string[];
  completedAt: string | null;
  currentStep: number;
  failureReason: string | null;
  goal: string;
  id: string;
  incidentId: string;
  nextWakeAt: string | null;
  planVersion: number;
  priority: number;
  startedAt: string;
  status: MissionStatus;
  successCriteria: string[];
  triggerReason: Record<string, unknown>;
  updatedAt: string;
  wakeCycle: number;
}

export interface MissionStepRecord {
  completedAt: string | null;
  decisionAudit: CounterfactualAudit | null;
  error: string | null;
  id: string;
  missionId: string;
  planVersion: number;
  rationale: string;
  requiresFreshObservation: boolean;
  result: unknown;
  startedAt: string | null;
  status: MissionStepStatus;
  stepOrder: number;
  toolArguments: Record<string, unknown>;
  toolName: MissionPlan["steps"][number]["tool"];
}

export interface MissionTimelineEvent {
  eventType: string;
  incidentId: string;
  message: string;
  metadata: Record<string, unknown>;
  missionId: string;
}

export interface MissionObservationRecord {
  changeSummary: ImpactChange | Record<string, never>;
  createdAt: string;
  id: string;
  incidentId: string;
  missionId: string;
  observationType: string;
  stateFingerprint: string;
  stateSnapshot: IncidentSnapshot;
}

export interface ToolExecutionRecord {
  approvalAlertId: string | null;
  approvalStatus: "approved" | "not_required" | "pending" | "rejected" | null;
  arguments: Record<string, unknown>;
  argumentsFingerprint: string;
  completedAt: string | null;
  error: string | null;
  id: string;
  latencyMs: number | null;
  missionId: string;
  missionStepId: string | null;
  result: unknown;
  securityStatus: string;
  startedAt: string | null;
  status: "blocked" | "completed" | "failed" | "pending" | "running";
  toolName: ToolName;
}

export interface CreateMissionInput {
  goal: string;
  incidentId: string;
  priority: number;
  triggerReason: Record<string, unknown>;
}

export interface PersistPlanInput {
  missionId: string;
  plan: MissionPlan;
  planVersion: number;
  usedFallback: boolean;
  validationFailures: string[];
}

export interface MissionTransitionPatch {
  completedAt?: string | null | undefined;
  currentStep?: number | undefined;
  failureReason?: string | null | undefined;
  nextWakeAt?: string | null | undefined;
  wakeCycle?: number | undefined;
}

export interface MissionStepResultInput {
  audit?: CounterfactualAudit | null | undefined;
  error?: string | null | undefined;
  result?: unknown;
  status: Exclude<MissionStepStatus, "planned" | "running">;
  stepId: string;
}

export interface MissionRepository {
  appendTimeline(event: MissionTimelineEvent): Promise<void>;
  createMission(
    input: CreateMissionInput,
  ): Promise<{ created: boolean; mission: MissionRecord }>;
  getMission(missionId: string): Promise<MissionRecord | null>;
  listSteps(
    missionId: string,
    planVersion: number,
  ): Promise<MissionStepRecord[]>;
  markStepRunning(stepId: string): Promise<MissionStepRecord>;
  getLatestObservation(
    missionId: string,
  ): Promise<MissionObservationRecord | null>;
  persistPlan(input: PersistPlanInput): Promise<MissionRecord>;
  recordStepResult(input: MissionStepResultInput): Promise<MissionStepRecord>;
  recordObservation(input: {
    changeSummary: ImpactChange | Record<string, never>;
    incidentId: string;
    missionId: string;
    observationType: string;
    stateFingerprint: string;
    stateSnapshot: IncidentSnapshot;
  }): Promise<MissionObservationRecord>;
  transitionMission(
    missionId: string,
    expected: MissionStatus | MissionStatus[],
    status: MissionStatus,
    patch?: MissionTransitionPatch,
  ): Promise<MissionRecord>;
}

export interface MissionRuntimeRepository extends MissionRepository {
  beginToolExecution(input: {
    approvalRequired: boolean;
    arguments: Record<string, unknown>;
    argumentsFingerprint: string;
    missionId: string;
    missionStepId: string;
    securityStatus: string;
    toolName: ToolName;
  }): Promise<ToolExecutionRecord>;
  claimMissions(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<MissionRecord[]>;
  decideToolApproval(
    executionId: string,
    operator: string,
    approved: boolean,
  ): Promise<ToolExecutionRecord>;
  finishToolExecution(input: {
    error: string | null;
    executionId: string;
    latencyMs: number;
    result: unknown;
    securityStatus: string;
    status: "blocked" | "completed" | "failed";
  }): Promise<ToolExecutionRecord>;
  getMissionApprovalDecision(
    missionId: string,
  ): Promise<"approved" | "pending" | "rejected" | null>;
  markToolExecutionRunning(executionId: string): Promise<ToolExecutionRecord>;
  releaseClaim(missionId: string, workerId: string): Promise<void>;
}
