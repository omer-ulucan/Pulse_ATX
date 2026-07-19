import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { IncidentCommander } from "../src/commander/incident-commander.js";
import {
  MissionExecutionEngine,
  type MissionContextProvider,
  type MissionToolExecutionRequest,
  type MissionToolRunner,
} from "../src/commander/mission-engine.js";
import { MemoryMissionRepository } from "../src/commander/memory-mission-repository.js";
import { MissionPlanner } from "../src/commander/mission-planner.js";
import { evaluateMissionTrigger } from "../src/commander/mission-trigger.js";
import { createDefaultToolRegistry } from "../src/commander/tools/default-tools.js";
import type { IncidentSnapshot } from "../src/commander/tools/types.js";
import type { ChatModel } from "../src/models/types.js";

const incidentId = randomUUID();
const fixedNow = new Date("2026-07-19T14:00:00.000Z");

function snapshot(overrides: Partial<IncidentSnapshot> = {}): IncidentSnapshot {
  return {
    affectedRoutes: ["801"],
    blockedLanes: 1,
    confidence: 0.82,
    correlatedFeedCount: 3,
    geographicSpreadKm: 1.1,
    incidentId,
    predictedDurationMinutes: 24,
    severity: 3,
    status: "active",
    transitDelayMinutes: 5,
    updatedAt: fixedNow.toISOString(),
    weatherSeverity: "heavy_rain",
    ...overrides,
  };
}

function planJson(stepCount = 2): string {
  const steps: Array<Record<string, unknown>> = [
    {
      arguments: { incidentId, limit: 6 },
      order: 1,
      rationale: "Retrieve comparable completed incidents.",
      requiresFreshObservation: false,
      tool: "retrieve_similar_incidents",
    },
    {
      arguments: { incidentId },
      order: 2,
      rationale: "Check the affected rapid transit route.",
      requiresFreshObservation: false,
      tool: "find_affected_transit_routes",
    },
    {
      arguments: { incidentId },
      order: 3,
      rationale: "Confirm current rain amplification evidence.",
      requiresFreshObservation: false,
      tool: "check_weather_conditions",
    },
  ].slice(0, Math.max(0, stepCount - 1));
  steps.push({
    arguments: { afterSeconds: 60, missionId: "MISSION_ID" },
    order: steps.length + 1,
    rationale: "Recheck live conditions before taking further action.",
    requiresFreshObservation: false,
    tool: "schedule_incident_recheck",
  });
  return JSON.stringify({
    assumptions: ["City feeds are current at the observation timestamp."],
    goal: "Minimize commuter disruption around North Lamar while monitoring escalation.",
    priority: 3,
    recheckAfterSeconds: 60,
    steps,
    successCriteria: ["Recheck correlated live conditions before closure."],
  });
}

class QueueModel implements ChatModel {
  readonly modelName = "nemotron-3-nano";
  readonly prompts: string[] = [];

  constructor(private readonly outputs: string[]) {}

  complete(_systemPrompt: string, userPrompt: string): Promise<string> {
    this.prompts.push(userPrompt);
    const output = this.outputs.shift();
    if (output === undefined) throw new Error("No mock model output remains");
    return Promise.resolve(output);
  }
}

class StaticContextProvider implements MissionContextProvider {
  constructor(private readonly value: IncidentSnapshot) {}

  getIncidentSnapshot(): Promise<IncidentSnapshot> {
    return Promise.resolve(this.value);
  }

  getRelevantLessons(): Promise<Record<string, unknown>[]> {
    return Promise.resolve([
      {
        pattern: "rain_amplified_lane_blocking_collision_near_rapid_transit",
        timingLesson: "Recheck within one minute.",
      },
    ]);
  }
}

class CompletingRunner implements MissionToolRunner {
  readonly calls: MissionToolExecutionRequest[] = [];

  constructor(private readonly scheduleWaits = true) {}

  execute(
    request: MissionToolExecutionRequest,
  ): Promise<
    | { result: unknown; status: "completed" }
    | { nextWakeAt: string; result: unknown; status: "waiting" }
  > {
    this.calls.push(request);
    if (
      this.scheduleWaits &&
      request.step.toolName === "schedule_incident_recheck"
    ) {
      return Promise.resolve({
        nextWakeAt: "2026-07-19T14:01:00.000Z",
        result: {
          missionId: request.mission.id,
          nextWakeAt: "2026-07-19T14:01:00.000Z",
        },
        status: "waiting",
      });
    }
    return Promise.resolve({ result: { ok: true }, status: "completed" });
  }
}

function replaceMissionId(output: string, missionId: string): string {
  return output.replaceAll("MISSION_ID", missionId);
}

describe("Autonomous Incident Commander planning and execution", () => {
  it("creates missions at the action threshold and ignores low impact events", () => {
    expect(evaluateMissionTrigger({ snapshot: snapshot() })).toMatchObject({
      qualifies: true,
      reason: { severityAtLeast3: true },
    });
    expect(
      evaluateMissionTrigger({
        snapshot: snapshot({
          affectedRoutes: ["local-shuttle"],
          correlatedFeedCount: 1,
          predictedDurationMinutes: 12,
          severity: 2,
          transitDelayMinutes: 1,
          weatherSeverity: "clear",
        }),
      }),
    ).toMatchObject({ qualifies: false });
  });

  it("persists a validated bounded plan and waits after execution", async () => {
    const repository = new MemoryMissionRepository(() => fixedNow);
    const creation = await repository.createMission({
      goal: "Provisional operational goal for the active incident.",
      incidentId,
      priority: 3,
      triggerReason: { severityAtLeast3: true },
    });
    const model = new QueueModel([
      replaceMissionId(planJson(2), creation.mission.id),
    ]);
    const registry = createDefaultToolRegistry();
    const runner = new CompletingRunner();
    const engine = new MissionExecutionEngine(
      repository,
      new MissionPlanner(model, registry),
      registry,
      new StaticContextProvider(snapshot()),
      runner,
      { now: () => fixedNow },
    );

    const result = await engine.processMission(creation.mission.id);

    expect(result.mission).toMatchObject({
      currentStep: 2,
      goal: "Minimize commuter disruption around North Lamar while monitoring escalation.",
      status: "waiting",
    });
    expect(await repository.listSteps(creation.mission.id, 1)).toMatchObject([
      { status: "completed", stepOrder: 1 },
      { status: "waiting", stepOrder: 2 },
    ]);
    expect(repository.timeline.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "Plan version 1 created",
        "Goal established",
        "Recheck scheduled",
      ]),
    );
  });

  it("repairs one invalid model plan before persistence", async () => {
    const repository = new MemoryMissionRepository(() => fixedNow);
    const creation = await repository.createMission({
      goal: "Provisional operational goal for the active incident.",
      incidentId,
      priority: 3,
      triggerReason: {},
    });
    const model = new QueueModel([
      JSON.stringify({
        ...JSON.parse(replaceMissionId(planJson(), creation.mission.id)),
        steps: [
          {
            arguments: {},
            order: 1,
            rationale: "Execute an unsafe arbitrary operation.",
            requiresFreshObservation: false,
            tool: "run_shell",
          },
        ],
      }),
      replaceMissionId(planJson(), creation.mission.id),
    ]);
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(model, registry);

    const result = await planner.createPlan({
      incidentSnapshot: snapshot(),
      missionId: creation.mission.id,
      relevantLessons: [],
      triggerReason: {},
    });

    expect(result).toMatchObject({ attempts: 2, usedFallback: false });
    expect(result.validationFailures).toHaveLength(1);
    expect(model.prompts[1]).toContain("Repair it without adding facts");
  });

  it("uses a deterministic safe plan after two invalid responses", async () => {
    const missionId = randomUUID();
    const planner = new MissionPlanner(
      new QueueModel(["not json", '{"goal":"still invalid"}']),
      createDefaultToolRegistry(),
    );

    const result = await planner.createPlan({
      incidentSnapshot: snapshot(),
      missionId,
      relevantLessons: [],
      triggerReason: { severityAtLeast3: true },
    });

    expect(result).toMatchObject({ attempts: 2, usedFallback: true });
    expect(result.validationFailures).toHaveLength(2);
    expect(result.plan.steps.map((step) => step.tool)).toEqual([
      "retrieve_similar_incidents",
      "find_affected_transit_routes",
      "check_weather_conditions",
      "create_alert_draft",
      "schedule_incident_recheck",
    ]);
    expect(result.plan.steps[3]?.arguments).toMatchObject({
      affectedRoutes: ["801"],
      incidentId,
      severity: 3,
    });
  });

  it("stops at the configured wake-cycle execution budget", async () => {
    const repository = new MemoryMissionRepository(() => fixedNow);
    const creation = await repository.createMission({
      goal: "Provisional operational goal for the active incident.",
      incidentId,
      priority: 3,
      triggerReason: {},
    });
    const model = new QueueModel([
      replaceMissionId(planJson(4), creation.mission.id),
    ]);
    const registry = createDefaultToolRegistry();
    const runner = new CompletingRunner(false);
    const engine = new MissionExecutionEngine(
      repository,
      new MissionPlanner(model, registry),
      registry,
      new StaticContextProvider(snapshot()),
      runner,
      { maxToolExecutionsPerWake: 2, now: () => fixedNow },
    );

    const result = await engine.processMission(creation.mission.id);

    expect(result).toMatchObject({
      executions: 2,
      mission: { status: "waiting" },
    });
    expect(runner.calls).toHaveLength(2);
    expect(repository.timeline.at(-1)?.eventType).toBe(
      "mission_execution_budget_exhausted",
    );
  });

  it("creates at most one active mission when the same incident repeats", async () => {
    const repository = new MemoryMissionRepository(() => fixedNow);
    const registry = createDefaultToolRegistry();
    const model = new QueueModel([]);
    const engine = new MissionExecutionEngine(
      repository,
      new MissionPlanner(model, registry),
      registry,
      new StaticContextProvider(snapshot()),
      new CompletingRunner(),
      { now: () => fixedNow },
    );
    const commander = new IncidentCommander(repository, engine);
    const first = await repository.createMission({
      goal: "Minimize repeat incident disruption with one active mission.",
      incidentId,
      priority: 3,
      triggerReason: {},
    });
    const duplicate = await repository.createMission({
      goal: "This duplicate should reuse the active mission record.",
      incidentId,
      priority: 3,
      triggerReason: {},
    });

    expect(duplicate.created).toBe(false);
    expect(duplicate.mission.id).toBe(first.mission.id);
    expect(commander).toBeDefined();
  });
});
