import type {
  CounterfactualAudit,
  MissionPlan,
  MissionStatus,
  MissionStepStatus,
} from "./mission-schemas.js";

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
  persistPlan(input: PersistPlanInput): Promise<MissionRecord>;
  recordStepResult(input: MissionStepResultInput): Promise<MissionStepRecord>;
  transitionMission(
    missionId: string,
    expected: MissionStatus | MissionStatus[],
    status: MissionStatus,
    patch?: MissionTransitionPatch,
  ): Promise<MissionRecord>;
}
