import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  MissionContextProvider,
  MissionToolExecutionRequest,
  MissionToolRunner,
} from "../src/commander/mission-engine.js";
import { MissionExecutionEngine } from "../src/commander/mission-engine.js";
import {
  MissionLifecycleCoordinator,
  type MissionCandidateProvider,
} from "../src/commander/mission-lifecycle.js";
import { MemoryMissionRepository } from "../src/commander/memory-mission-repository.js";
import { MissionPlanner } from "../src/commander/mission-planner.js";
import {
  OpenShellToolPolicy,
  SecureMissionToolRunner,
} from "../src/commander/secure-tool-runner.js";
import { createDefaultToolRegistry } from "../src/commander/tools/default-tools.js";
import type {
  IncidentSnapshot,
  ToolOperations,
} from "../src/commander/tools/types.js";
import type { ChatModel } from "../src/models/types.js";
import {
  ToolSecurityBoundary,
  type SecurityScanResult,
  type SecurityScanner,
  type SecurityStage,
} from "../src/security/types.js";

const incidentId = randomUUID();

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
    updatedAt: "2026-07-19T14:00:00.000Z",
    weatherSeverity: "heavy_rain",
    ...overrides,
  };
}

class QueueModel implements ChatModel {
  readonly modelName = "nemotron-3-nano";

  constructor(private readonly outputs: string[]) {}

  complete(): Promise<string> {
    const output = this.outputs.shift();
    if (!output) throw new Error("No mock Nemotron output remains");
    return Promise.resolve(output);
  }
}

class MutableProvider implements MissionCandidateProvider {
  candidates: IncidentSnapshot[] = [];

  constructor(public current: IncidentSnapshot) {}

  getIncidentSnapshot(): Promise<IncidentSnapshot> {
    return Promise.resolve(this.current);
  }

  getRelevantLessons(): Promise<Record<string, unknown>[]> {
    return Promise.resolve([]);
  }

  listMissionCandidates(): Promise<IncidentSnapshot[]> {
    return Promise.resolve(this.candidates);
  }
}

class FlakyProvider extends MutableProvider {
  calls = 0;

  constructor(
    current: IncidentSnapshot,
    private readonly failures: number,
  ) {
    super(current);
  }

  override getIncidentSnapshot(): Promise<IncidentSnapshot> {
    this.calls += 1;
    if (this.calls <= this.failures) {
      return Promise.reject(new Error("Transient Supabase read failure"));
    }
    return Promise.resolve(this.current);
  }
}

class LifecycleRunner implements MissionToolRunner {
  constructor(private readonly now: () => Date) {}

  execute(request: MissionToolExecutionRequest) {
    if (request.step.toolName === "publish_simulated_alert") {
      return Promise.resolve({
        result: { action: "publish_simulated_alert" },
        status: "waiting_approval" as const,
      });
    }
    if (request.step.toolName === "schedule_incident_recheck") {
      const afterSeconds = Number(request.step.toolArguments.afterSeconds);
      const nextWakeAt = new Date(
        this.now().getTime() + afterSeconds * 1_000,
      ).toISOString();
      return Promise.resolve({
        nextWakeAt,
        result: { missionId: request.mission.id, nextWakeAt },
        status: "waiting" as const,
      });
    }
    return Promise.resolve({
      result: { ok: true },
      status: "completed" as const,
    });
  }
}

class MockScanner implements SecurityScanner {
  constructor(private readonly blockCalls = false) {}

  scan(stage: SecurityStage): Promise<SecurityScanResult> {
    const blocked = this.blockCalls && stage === "tool_call";
    return Promise.resolve({
      action: blocked ? "block" : "allow",
      blocked,
      details: {},
      detections: blocked
        ? [
            {
              category: "prompt_injection",
              message:
                "Untrusted tool argument attempted instruction override.",
              severity: "high",
            },
          ]
        : [],
      eventId: null,
      provider: "hiddenlayer-mock",
      stage,
    });
  }
}

class MockOperations implements ToolOperations {
  publishCalls = 0;

  cancelPendingAction() {
    return Promise.resolve({ cancelled: true });
  }
  checkWeatherConditions() {
    return Promise.resolve({
      amplification: "high" as const,
      observedAt: "2026-07-19T14:00:00.000Z",
      precipitation: "heavy" as const,
      summary: "Heavy rain is amplifying the incident.",
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
      requiresApproval: false,
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
    this.publishCalls += 1;
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
      requiresApproval: false,
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

class ScenarioOperations implements ToolOperations, MissionCandidateProvider {
  alertId = randomUUID();
  alertStatus: "approved" | "draft" | "pending_approval" | "published" =
    "draft";
  lessonInput: Parameters<ToolOperations["storeIncidentLesson"]>[0] | null =
    null;
  outcomeInput: Parameters<ToolOperations["recordIncidentOutcome"]>[0] | null =
    null;
  publishCalls = 0;
  severityChanges: number[] = [];

  constructor(
    public current: IncidentSnapshot,
    private readonly now: () => Date,
  ) {}

  cancelPendingAction() {
    return Promise.resolve({ cancelled: true });
  }
  checkWeatherConditions() {
    return Promise.resolve({
      amplification:
        this.current.weatherSeverity === "heavy_rain"
          ? ("high" as const)
          : ("moderate" as const),
      observedAt: this.current.updatedAt,
      precipitation:
        this.current.weatherSeverity === "heavy_rain"
          ? ("heavy" as const)
          : ("light" as const),
      summary: "Correlated weather evidence reflects the current wake cycle.",
    });
  }
  closeIncident(input: { incidentId: string }) {
    return Promise.resolve({
      closedAt: this.now().toISOString(),
      incidentId: input.incidentId,
      status: "resolved" as const,
    });
  }
  createAlertDraft(input: {
    audience: "affected_routes" | "city_operators" | "citywide";
  }) {
    this.alertStatus = "draft";
    return Promise.resolve({
      alertId: this.alertId,
      audience: input.audience,
      requiresApproval: false,
      status: "draft" as const,
    });
  }
  findAffectedTransitRoutes() {
    return Promise.resolve(
      this.current.affectedRoutes.map((routeId) => ({
        delayMinutes: this.current.transitDelayMinutes,
        major: routeId === "801" || routeId === "1",
        routeId,
        routeName: routeId === "801" ? "Rapid 801" : `Route ${routeId}`,
      })),
    );
  }
  getIncidentSnapshot() {
    return Promise.resolve(this.current);
  }
  getRelevantLessons() {
    return Promise.resolve([]);
  }
  listMissionCandidates() {
    return Promise.resolve([]);
  }
  publishSimulatedAlert() {
    this.publishCalls += 1;
    this.alertStatus = "published";
    return Promise.resolve({
      alertId: this.alertId,
      channel: "dashboard_simulation" as const,
      publishedAt: this.now().toISOString(),
    });
  }
  recordIncidentOutcome(
    input: Parameters<ToolOperations["recordIncidentOutcome"]>[0],
  ) {
    this.outcomeInput = input;
    return Promise.resolve({ outcomeId: randomUUID() });
  }
  requestHumanApproval() {
    this.alertStatus = "pending_approval";
    return Promise.resolve({
      alertId: this.alertId,
      status: "pending_approval" as const,
    });
  }
  retrieveSimilarIncidents() {
    return Promise.resolve([]);
  }
  reviseAlertDraft(input: {
    audience: "affected_routes" | "city_operators" | "citywide";
  }) {
    this.alertStatus = "draft";
    return Promise.resolve({
      alertId: this.alertId,
      audience: input.audience,
      requiresApproval: true,
      status: "draft" as const,
    });
  }
  scheduleIncidentRecheck(input: { afterSeconds: number; missionId: string }) {
    return Promise.resolve({
      missionId: input.missionId,
      nextWakeAt: new Date(
        this.now().getTime() + input.afterSeconds * 1_000,
      ).toISOString(),
    });
  }
  storeIncidentLesson(
    input: Parameters<ToolOperations["storeIncidentLesson"]>[0],
  ) {
    this.lessonInput = input;
    return Promise.resolve({ memoryId: randomUUID() });
  }
  updateIncidentSeverity(input: { incidentId: string; severity: number }) {
    const previousSeverity = this.severityChanges.at(-1) ?? 3;
    this.severityChanges.push(input.severity);
    return Promise.resolve({
      incidentId: input.incidentId,
      previousSeverity,
      severity: input.severity,
    });
  }
}

async function createPersistedMission(
  repository: MemoryMissionRepository,
  tool: "get_incident_snapshot" | "publish_simulated_alert",
) {
  const creation = await repository.createMission({
    goal: "Minimize disruption around the active North Lamar incident.",
    incidentId,
    priority: 5,
    triggerReason: { severityAtLeast3: true },
  });
  const missionId = creation.mission.id;
  const mission = await repository.persistPlan({
    missionId,
    plan: {
      assumptions: [],
      goal: "Minimize disruption around the active North Lamar incident.",
      priority: 5,
      recheckAfterSeconds: 60,
      steps: [
        {
          arguments: { incidentId },
          order: 1,
          rationale: "Execute the selected bounded operational tool.",
          requiresFreshObservation: false,
          tool,
        },
        {
          arguments: { afterSeconds: 60, missionId },
          order: 2,
          rationale: "Recheck conditions after this bounded action.",
          requiresFreshObservation: false,
          tool: "schedule_incident_recheck",
        },
      ],
      successCriteria: ["Protected actions execute only after approval."],
    },
    planVersion: 1,
    usedFallback: false,
    validationFailures: [],
  });
  const step = (await repository.listSteps(missionId, 1))[0];
  if (!step) throw new Error("Test mission step was not persisted");
  return { mission, step };
}

describe("Autonomous Incident Commander approval and re-observation", () => {
  it("persists a HiddenLayer block before any tool operation executes", async () => {
    const repository = new MemoryMissionRepository();
    const { mission, step } = await createPersistedMission(
      repository,
      "get_incident_snapshot",
    );
    const registry = createDefaultToolRegistry();
    const operations = new MockOperations();
    const runner = new SecureMissionToolRunner(
      registry,
      repository,
      new ToolSecurityBoundary(new MockScanner(true)),
      new OpenShellToolPolicy(),
      operations,
    );

    const result = await runner.execute({
      audit: null,
      mission,
      snapshot: snapshot({ severity: 5 }),
      step,
    });

    expect(result).toMatchObject({ status: "failed" });
    expect(repository.listToolExecutions(mission.id)).toMatchObject([
      { securityStatus: "hiddenlayer_blocked", status: "blocked" },
    ]);
  });

  it("pauses a protected action, resumes after approval, and stays idempotent", async () => {
    const repository = new MemoryMissionRepository();
    const { mission, step } = await createPersistedMission(
      repository,
      "publish_simulated_alert",
    );
    const registry = createDefaultToolRegistry();
    const operations = new MockOperations();
    const runner = new SecureMissionToolRunner(
      registry,
      repository,
      new ToolSecurityBoundary(new MockScanner()),
      new OpenShellToolPolicy(),
      operations,
    );
    const request = {
      audit: null,
      mission,
      snapshot: snapshot({ severity: 5 }),
      step,
    };

    const paused = await runner.execute(request);
    expect(paused).toMatchObject({ status: "waiting_approval" });
    expect(operations.publishCalls).toBe(0);
    const execution = repository.listToolExecutions(mission.id)[0];
    if (!execution) throw new Error("Pending execution was not persisted");
    await repository.decideToolApproval(execution.id, "Austin Operator", true);

    await expect(runner.execute(request)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(runner.execute(request)).resolves.toMatchObject({
      status: "completed",
    });
    expect(operations.publishCalls).toBe(1);
  });

  it("resumes the same paused mission after an approved database state", async () => {
    const clock = new Date("2026-07-19T14:00:00.000Z");
    const repository = new MemoryMissionRepository(() => clock);
    const creation = await repository.createMission({
      goal: "Publish a targeted alert only through the operator boundary.",
      incidentId,
      priority: 5,
      triggerReason: { severityAtLeast3: true },
    });
    const missionId = creation.mission.id;
    const plan = JSON.stringify({
      assumptions: ["The prepared alert reflects the latest verified state."],
      goal: "Publish a targeted alert only through the operator boundary.",
      priority: 5,
      recheckAfterSeconds: 60,
      steps: [
        {
          arguments: { incidentId },
          order: 1,
          rationale: "Publish the prepared alert only after operator approval.",
          requiresFreshObservation: false,
          tool: "publish_simulated_alert",
        },
        {
          arguments: { afterSeconds: 60, missionId },
          order: 2,
          rationale: "Recheck live conditions after publication.",
          requiresFreshObservation: false,
          tool: "schedule_incident_recheck",
        },
      ],
      successCriteria: ["No protected action bypasses operator approval."],
    });
    const audit = JSON.stringify({
      alternatives: [
        {
          confidence: 0.84,
          expectedBenefit: "Avoids unnecessary notification.",
          expectedRisk: "Affected riders remain uninformed.",
          name: "No action",
          reversibility: "high",
        },
        {
          confidence: 0.76,
          expectedBenefit: "Waits for another live reading.",
          expectedRisk: "Warning arrives after disruption grows.",
          name: "Delayed action",
          reversibility: "high",
        },
      ],
      selectedAction: "Publish targeted Route 801 alert.",
      selectionReason: "Verified severity supports a bounded targeted alert.",
    });
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(new QueueModel([plan, audit]), registry);
    const operations = new MockOperations();
    const provider = new MutableProvider(snapshot({ severity: 5 }));
    const runner = new SecureMissionToolRunner(
      registry,
      repository,
      new ToolSecurityBoundary(new MockScanner()),
      new OpenShellToolPolicy(),
      operations,
    );
    const engine = new MissionExecutionEngine(
      repository,
      planner,
      registry,
      provider,
      runner,
      { now: () => clock },
    );
    const lifecycle = new MissionLifecycleCoordinator(
      repository,
      planner,
      engine,
      provider,
      { now: () => clock, workerId: "approval-resume-worker" },
    );

    await lifecycle.processBatch();
    expect(await repository.getMission(missionId)).toMatchObject({
      currentStep: 1,
      status: "waiting_approval",
    });
    const pending = repository.listToolExecutions(missionId)[0];
    if (!pending) throw new Error("Protected execution was not persisted");
    await repository.decideToolApproval(pending.id, "Austin Operator", true);

    await lifecycle.processBatch();

    expect(await repository.getMission(missionId)).toMatchObject({
      currentStep: 2,
      id: missionId,
      status: "waiting",
    });
    expect(operations.publishCalls).toBe(1);
    expect(repository.timeline.map((event) => event.message)).toContain(
      "Approved mission action resumed",
    );
  });

  it("wakes automatically, compares fresh state, and creates plan version 2", async () => {
    let clock = new Date("2026-07-19T14:00:00.000Z");
    const now = () => clock;
    const repository = new MemoryMissionRepository(now);
    const creation = await repository.createMission({
      goal: "Minimize commuter disruption around North Lamar Boulevard.",
      incidentId,
      priority: 3,
      triggerReason: { severityAtLeast3: true },
    });
    const missionId = creation.mission.id;
    const initialPlan = JSON.stringify({
      assumptions: ["Traffic, transit, and weather feeds are current."],
      goal: "Minimize commuter disruption around North Lamar Boulevard.",
      priority: 3,
      recheckAfterSeconds: 60,
      steps: [
        {
          arguments: { incidentId, limit: 6 },
          order: 1,
          rationale: "Retrieve comparable completed incidents.",
          requiresFreshObservation: false,
          tool: "retrieve_similar_incidents",
        },
        {
          arguments: { afterSeconds: 60, missionId },
          order: 2,
          rationale: "Recheck live conditions after one minute.",
          requiresFreshObservation: false,
          tool: "schedule_incident_recheck",
        },
      ],
      successCriteria: ["Observe recovery before incident closure."],
    });
    const revision = JSON.stringify({
      decision: "escalate",
      explanation:
        "Transit delay increased by nine minutes and a second lane is blocked.",
      newSeverity: 5,
      recheckAfterSeconds: 60,
    });
    const audit = JSON.stringify({
      alternatives: [
        {
          confidence: 0.86,
          expectedBenefit: "Avoids an unnecessary alert.",
          expectedRisk: "Delay continues without commuter notice.",
          name: "No action",
          reversibility: "high",
        },
        {
          confidence: 0.78,
          expectedBenefit: "Adds one more observation.",
          expectedRisk: "A timely warning is delayed.",
          name: "Delayed action",
          reversibility: "high",
        },
      ],
      selectedAction: "Publish the revised Route 801 alert after approval.",
      selectionReason:
        "Current lane and delay evidence supports targeted notice.",
    });
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(
      new QueueModel([initialPlan, revision, audit]),
      registry,
    );
    const provider = new MutableProvider(snapshot());
    const engine = new MissionExecutionEngine(
      repository,
      planner,
      registry,
      provider as MissionContextProvider,
      new LifecycleRunner(now),
      { now },
    );
    const lifecycle = new MissionLifecycleCoordinator(
      repository,
      planner,
      engine,
      provider,
      { now, workerId: "mission-worker-test" },
    );

    await lifecycle.processBatch();
    expect(await repository.getMission(missionId)).toMatchObject({
      planVersion: 1,
      status: "waiting",
    });

    clock = new Date("2026-07-19T14:01:00.000Z");
    provider.current = snapshot({
      affectedRoutes: ["801", "1"],
      blockedLanes: 2,
      predictedDurationMinutes: 43,
      severity: 5,
      transitDelayMinutes: 14,
      updatedAt: clock.toISOString(),
    });
    const result = await lifecycle.processBatch();

    expect(result).toMatchObject({ claimed: 1, waiting: 1 });
    expect(await repository.getMission(missionId)).toMatchObject({
      currentStep: 4,
      planVersion: 2,
      status: "waiting_approval",
      wakeCycle: 1,
    });
    expect(await repository.getLatestObservation(missionId)).toMatchObject({
      changeSummary: {
        blockedLanes: { delta: 1 },
        predictedDurationMinutes: { delta: 19 },
        severity: { delta: 2 },
        transitDelayMinutes: { delta: 9 },
      },
      observationType: "scheduled_recheck",
    });
    expect(await repository.listSteps(missionId, 1)).toHaveLength(2);
    expect(await repository.listSteps(missionId, 2)).toHaveLength(5);
    expect(repository.timeline.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "Agent woke for re-evaluation",
        "Live conditions worsened",
        "Plan version 2 created",
        "Human approval requested",
      ]),
    );
  });

  it("falls back to deterministic de-escalation when revision output fails", async () => {
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(
      new QueueModel(["not-json", '{"decision":"unknown"}']),
      registry,
    );
    const before = snapshot({
      blockedLanes: 2,
      predictedDurationMinutes: 43,
      severity: 5,
      transitDelayMinutes: 14,
    });
    const after = snapshot({
      blockedLanes: 0,
      predictedDurationMinutes: 40,
      severity: 2,
      transitDelayMinutes: 2,
      weatherSeverity: "light_rain",
    });
    const changeSummary = {
      affectedRouteCount: { after: 1, before: 1, delta: 0 },
      blockedLanes: { after: 0, before: 2, delta: -2 },
      confidence: { after: 0.82, before: 0.82, delta: 0 },
      geographicSpreadKm: { after: 1.1, before: 1.1, delta: 0 },
      meaningful: true,
      predictedDurationMinutes: { after: 40, before: 43, delta: -3 },
      severity: { after: 2, before: 5, delta: -3 },
      status: { after: "active", before: "active", changed: false },
      transitDelayMinutes: { after: 2, before: 14, delta: -12 },
      weatherSeverity: {
        after: "light_rain",
        before: "heavy_rain",
        changed: true,
      },
    } as const;
    const result = await planner.revisePlan({
      changeSummary,
      currentPlan: {
        assumptions: [],
        goal: "Minimize commuter disruption around North Lamar Boulevard.",
        priority: 5,
        recheckAfterSeconds: 60,
        steps: [
          {
            arguments: { afterSeconds: 60, missionId: randomUUID() },
            order: 1,
            rationale: "Recheck live conditions after one minute.",
            requiresFreshObservation: false,
            tool: "schedule_incident_recheck",
          },
        ],
        successCriteria: ["Observe recovery before closure."],
      },
      currentSnapshot: after,
      priorSnapshot: before,
    });

    expect(result).toMatchObject({
      revision: { decision: "deescalate", newSeverity: 2 },
      usedFallback: true,
    });
  });

  it("runs the deterministic collision story through outcome and mission memory", async () => {
    let clock = new Date("2026-07-19T14:00:00.000Z");
    const now = () => clock;
    const repository = new MemoryMissionRepository(now);
    const creation = await repository.createMission({
      goal: "Minimize commuter disruption around North Lamar while monitoring for escalation.",
      incidentId,
      priority: 3,
      triggerReason: {
        correlatedFeeds: true,
        predictedDurationOver20: true,
        severityAtLeast3: true,
      },
    });
    const missionId = creation.mission.id;
    const initialPlan = JSON.stringify({
      assumptions: ["Traffic, transit, and weather feeds are correlated."],
      goal: "Minimize commuter disruption around North Lamar while monitoring for escalation.",
      priority: 3,
      recheckAfterSeconds: 60,
      steps: [
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
          rationale: "Confirm heavy-rain amplification.",
          requiresFreshObservation: false,
          tool: "check_weather_conditions",
        },
        {
          arguments: {
            affectedRoutes: ["801"],
            audience: "affected_routes",
            incidentId,
            message:
              "Route 801 riders should prepare for North Lamar disruption while one lane remains blocked.",
            severity: 3,
            title: "North Lamar disruption under monitoring",
          },
          order: 4,
          rationale: "Prepare a targeted commuter alert draft.",
          requiresFreshObservation: false,
          tool: "create_alert_draft",
        },
        {
          arguments: { afterSeconds: 60, missionId },
          order: 5,
          rationale: "Recheck live conditions before protected action.",
          requiresFreshObservation: false,
          tool: "schedule_incident_recheck",
        },
      ],
      successCriteria: [
        "Protected publication requires operator approval.",
        "The incident closes only after sustained recovery.",
      ],
    });
    const escalation = JSON.stringify({
      decision: "escalate",
      explanation:
        "A second blocked lane and nine additional transit-delay minutes invalidate the initial assumptions.",
      newSeverity: 5,
      recheckAfterSeconds: 60,
    });
    const audit = JSON.stringify({
      alternatives: [
        {
          confidence: 0.9,
          expectedBenefit: "Avoids unnecessary notification.",
          expectedRisk: "Route 801 riders receive no warning.",
          name: "No action",
          reversibility: "high",
        },
        {
          confidence: 0.78,
          expectedBenefit: "Adds one more observation.",
          expectedRisk: "A useful alert arrives late.",
          name: "Delayed action",
          reversibility: "high",
        },
      ],
      selectedAction: "Publish targeted Route 801 commuter alert",
      selectionReason:
        "Two blocked lanes and a fourteen-minute delay justify targeted notice after approval.",
    });
    const deescalation = JSON.stringify({
      decision: "deescalate",
      explanation:
        "Reopened lanes, lower transit delay, and weakening rain remove the escalation basis.",
      newSeverity: 2,
      recheckAfterSeconds: 60,
    });
    const completion = JSON.stringify({
      decision: "complete",
      explanation:
        "A final observation confirms sustained lane and transit recovery.",
    });
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(
      new QueueModel([
        initialPlan,
        escalation,
        audit,
        deescalation,
        completion,
      ]),
      registry,
    );
    const operations = new ScenarioOperations(snapshot(), now);
    const runner = new SecureMissionToolRunner(
      registry,
      repository,
      new ToolSecurityBoundary(new MockScanner()),
      new OpenShellToolPolicy(),
      operations,
    );
    const engine = new MissionExecutionEngine(
      repository,
      planner,
      registry,
      operations,
      runner,
      { now },
    );
    const lifecycle = new MissionLifecycleCoordinator(
      repository,
      planner,
      engine,
      operations,
      { now, workerId: "full-demo-worker" },
    );

    await lifecycle.processBatch();
    expect(await repository.getMission(missionId)).toMatchObject({
      planVersion: 1,
      status: "waiting",
    });

    clock = new Date("2026-07-19T14:01:00.000Z");
    operations.current = snapshot({
      affectedRoutes: ["801", "1"],
      blockedLanes: 2,
      predictedDurationMinutes: 43,
      severity: 5,
      transitDelayMinutes: 14,
      updatedAt: clock.toISOString(),
    });
    await lifecycle.processBatch();
    expect(await repository.getMission(missionId)).toMatchObject({
      planVersion: 2,
      status: "waiting_approval",
    });
    const pending = repository
      .listToolExecutions(missionId)
      .find((execution) => execution.approvalStatus === "pending");
    if (!pending)
      throw new Error("Scenario approval boundary was not persisted");
    await repository.decideToolApproval(pending.id, "Austin Operator", true);
    await lifecycle.processBatch();
    expect(operations.publishCalls).toBe(1);

    clock = new Date("2026-07-19T14:02:00.000Z");
    operations.current = snapshot({
      blockedLanes: 0,
      observedDurationMinutes: 40,
      predictedDurationMinutes: 43,
      severity: 2,
      transitDelayMinutes: 2,
      updatedAt: clock.toISOString(),
      weatherSeverity: "light_rain",
    });
    await lifecycle.processBatch();
    expect(await repository.getMission(missionId)).toMatchObject({
      planVersion: 3,
      status: "waiting",
    });

    clock = new Date("2026-07-19T14:03:00.000Z");
    operations.current = snapshot({
      blockedLanes: 0,
      observedDurationMinutes: 40,
      predictedDurationMinutes: 43,
      severity: 2,
      transitDelayMinutes: 1,
      updatedAt: clock.toISOString(),
      weatherSeverity: "light_rain",
    });
    await lifecycle.processBatch();

    expect(await repository.getMission(missionId)).toMatchObject({
      planVersion: 4,
      status: "completed",
      wakeCycle: 3,
    });
    expect(await repository.listSteps(missionId, 1)).toHaveLength(5);
    expect(await repository.listSteps(missionId, 2)).toHaveLength(5);
    expect(await repository.listSteps(missionId, 3)).toHaveLength(3);
    expect(await repository.listSteps(missionId, 4)).toHaveLength(3);
    expect(operations.severityChanges).toEqual([5, 2]);
    expect(operations.alertStatus).toBe("published");
    expect(operations.outcomeInput).toMatchObject({
      actualDurationMinutes: 40,
      observedSeverity: 5,
      outcome: {
        finalPredictionError: 3,
        outcome: "successful",
        peakPredictionMinutes: 43,
      },
    });
    expect(operations.lessonInput).toMatchObject({
      lesson: {
        finalPredictionError: 3,
        pattern: "rain_amplified_lane_blocking_collision_near_rapid_transit",
        predictedOutcome: {
          escalatedDurationMinutes: 43,
          initialDurationMinutes: 24,
          peakSeverity: 5,
        },
      },
      missionId,
    });
    expect(repository.timeline.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "Tool call proposed",
        "Tool call security scan passed",
        "Historical incidents retrieved",
        "Transit routes checked",
        "Weather amplification confirmed",
        "Plan version 2 created",
        "Severity raised from 3 to 5",
        "Approved mission action resumed",
        "Alert published in simulation",
        "Conditions improved",
        "Severity lowered from 5 to 2",
        "Plan version 3 created",
        "Plan version 4 created",
        "Incident closed",
        "Outcome recorded",
        "Lesson stored",
        "Mission completed",
      ]),
    );
  });

  it("retries one transient mission-cycle failure without duplicating the mission", async () => {
    const clock = new Date("2026-07-19T14:00:00.000Z");
    const repository = new MemoryMissionRepository(() => clock);
    const creation = await repository.createMission({
      goal: "Recover bounded mission processing after a transient database failure.",
      incidentId,
      priority: 3,
      triggerReason: { severityAtLeast3: true },
    });
    const missionId = creation.mission.id;
    const plan = JSON.stringify({
      assumptions: ["The retry reads the same persisted mission state."],
      goal: "Recover bounded mission processing after a transient database failure.",
      priority: 3,
      recheckAfterSeconds: 60,
      steps: [
        {
          arguments: { afterSeconds: 60, missionId },
          order: 1,
          rationale: "Schedule the next bounded observation after recovery.",
          requiresFreshObservation: false,
          tool: "schedule_incident_recheck",
        },
      ],
      successCriteria: ["Transient failure does not duplicate mission state."],
    });
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(new QueueModel([plan]), registry);
    const provider = new FlakyProvider(snapshot(), 1);
    const engine = new MissionExecutionEngine(
      repository,
      planner,
      registry,
      provider,
      new LifecycleRunner(() => clock),
      { now: () => clock },
    );
    const lifecycle = new MissionLifecycleCoordinator(
      repository,
      planner,
      engine,
      provider,
      {
        now: () => clock,
        retryAttempts: 2,
        retryDelayMs: 0,
        workerId: "retry-worker",
      },
    );

    await expect(lifecycle.processBatch()).resolves.toMatchObject({
      claimed: 1,
      failed: 0,
      waiting: 1,
    });
    expect(provider.calls).toBe(2);
    expect(await repository.getMission(missionId)).toMatchObject({
      id: missionId,
      status: "waiting",
    });
  });

  it("fails safely after the bounded mission retry budget is exhausted", async () => {
    const clock = new Date("2026-07-19T14:00:00.000Z");
    const repository = new MemoryMissionRepository(() => clock);
    const creation = await repository.createMission({
      goal: "Stop mission processing after its bounded retry budget is exhausted.",
      incidentId,
      priority: 3,
      triggerReason: { severityAtLeast3: true },
    });
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(new QueueModel([]), registry);
    const provider = new FlakyProvider(snapshot(), 3);
    const engine = new MissionExecutionEngine(
      repository,
      planner,
      registry,
      provider,
      new LifecycleRunner(() => clock),
      { now: () => clock },
    );
    const lifecycle = new MissionLifecycleCoordinator(
      repository,
      planner,
      engine,
      provider,
      {
        now: () => clock,
        retryAttempts: 2,
        retryDelayMs: 0,
        workerId: "retry-exhaustion-worker",
      },
    );

    await expect(lifecycle.processBatch()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(await repository.getMission(creation.mission.id)).toMatchObject({
      failureReason: "Transient Supabase read failure",
      status: "failed",
    });
    expect(repository.timeline.at(-1)).toMatchObject({
      eventType: "mission_retry_budget_exhausted",
    });
  });

  it("cancels an approved protected action if the incident resolves before resume", async () => {
    const clock = new Date("2026-07-19T14:00:00.000Z");
    const repository = new MemoryMissionRepository(() => clock);
    const creation = await repository.createMission({
      goal: "Publish only while the protected incident action remains necessary.",
      incidentId,
      priority: 5,
      triggerReason: { severityAtLeast3: true },
    });
    const missionId = creation.mission.id;
    const plan = JSON.stringify({
      assumptions: ["The protected action is necessary only while active."],
      goal: "Publish only while the protected incident action remains necessary.",
      priority: 5,
      recheckAfterSeconds: 60,
      steps: [
        {
          arguments: { incidentId },
          order: 1,
          rationale: "Publish the targeted simulation only after approval.",
          requiresFreshObservation: false,
          tool: "publish_simulated_alert",
        },
        {
          arguments: { afterSeconds: 60, missionId },
          order: 2,
          rationale: "Recheck conditions after protected publication.",
          requiresFreshObservation: false,
          tool: "schedule_incident_recheck",
        },
      ],
      successCriteria: ["Resolved incidents cannot publish stale alerts."],
    });
    const audit = JSON.stringify({
      alternatives: [
        {
          confidence: 0.8,
          expectedBenefit: "Avoids unnecessary publication.",
          expectedRisk: "Active riders might remain uninformed.",
          name: "No action",
          reversibility: "high",
        },
        {
          confidence: 0.75,
          expectedBenefit: "Waits for another live observation.",
          expectedRisk: "A useful notice may arrive late.",
          name: "Delayed action",
          reversibility: "high",
        },
      ],
      selectedAction: "Publish the targeted simulated alert",
      selectionReason: "Active severity supports a bounded protected notice.",
    });
    const registry = createDefaultToolRegistry();
    const planner = new MissionPlanner(new QueueModel([plan, audit]), registry);
    const operations = new MockOperations();
    const provider = new MutableProvider(snapshot({ severity: 5 }));
    const runner = new SecureMissionToolRunner(
      registry,
      repository,
      new ToolSecurityBoundary(new MockScanner()),
      new OpenShellToolPolicy(),
      operations,
    );
    const engine = new MissionExecutionEngine(
      repository,
      planner,
      registry,
      provider,
      runner,
      { now: () => clock },
    );
    const lifecycle = new MissionLifecycleCoordinator(
      repository,
      planner,
      engine,
      provider,
      { now: () => clock, retryDelayMs: 0, workerId: "closure-worker" },
    );

    await lifecycle.processBatch();
    const pending = repository.listToolExecutions(missionId)[0];
    if (!pending) throw new Error("Protected action did not pause");
    await repository.decideToolApproval(pending.id, "Austin Operator", true);
    provider.current = snapshot({ severity: 1, status: "resolved" });

    await lifecycle.processBatch();

    expect(await repository.getMission(missionId)).toMatchObject({
      failureReason: "Incident resolved before the protected action executed",
      status: "cancelled",
    });
    expect(operations.publishCalls).toBe(0);
    expect(repository.timeline.at(-1)).toMatchObject({
      eventType: "mission_cancelled_incident_resolved",
    });
  });
});
