import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { MissionExecutionEngine } from "../apps/agent/src/commander/mission-engine.js";
import { MissionLifecycleCoordinator } from "../apps/agent/src/commander/mission-lifecycle.js";
import { MissionPlanner } from "../apps/agent/src/commander/mission-planner.js";
import {
  OpenShellToolPolicy,
  SecureMissionToolRunner,
} from "../apps/agent/src/commander/secure-tool-runner.js";
import { SupabaseCommanderOperations } from "../apps/agent/src/commander/supabase-commander-operations.js";
import { SupabaseMissionRepository } from "../apps/agent/src/commander/supabase-mission-repository.js";
import { createDefaultToolRegistry } from "../apps/agent/src/commander/tools/default-tools.js";
import type { IncidentSnapshot } from "../apps/agent/src/commander/tools/types.js";
import { SupabaseLearningRepository } from "../apps/agent/src/memory/learning-repository.js";
import { MemoryService } from "../apps/agent/src/memory/memory-service.js";
import type { ChatModel } from "../apps/agent/src/models/types.js";
import {
  ToolSecurityBoundary,
  type SecurityScanner,
} from "../apps/agent/src/security/types.js";

const EnvironmentSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_URL: z.url(),
});

const DemoStageResultSchema = z.object({
  incidentId: z.uuid(),
  nonce: z.uuid(),
  stage: z.enum(["initial", "escalation", "recovery", "final"]),
});

const MissionRowSchema = z.object({
  id: z.uuid(),
  plan_version: z.number().int(),
  status: z.string(),
});

const FinalResultSchema = z.object({
  actualDuration: z.literal(40),
  alertStatus: z.literal("published"),
  finalPredictionError: z.literal(3),
  initialPrediction: z.literal(24),
  memoryKind: z.literal("mission_lesson"),
  missionStatus: z.literal("completed"),
  planOutcome: z.literal("successful"),
  planVersion: z.literal(4),
  peakPrediction: z.literal(43),
});

class DeterministicEmbeddingProvider {
  embed(text: string): Promise<number[]> {
    const bytes = createHash("sha256").update(text).digest();
    return Promise.resolve(
      Array.from({ length: 384 }, (_, index) =>
        Number(
          (((bytes[index % bytes.length] ?? 0) - 127.5) / 127.5).toFixed(6),
        ),
      ),
    );
  }
}

class DemoNemotronModel implements ChatModel {
  readonly modelName = "nemotron-3-nano-demo-fixture";
  private revision = 0;

  constructor(private readonly incidentId: string) {}

  complete(systemPrompt: string, userPrompt: string): Promise<string> {
    if (systemPrompt.includes("decision auditor")) {
      return Promise.resolve(
        JSON.stringify({
          alternatives: [
            {
              confidence: 0.9,
              expectedBenefit:
                "Avoids an alert if conditions clear immediately.",
              expectedRisk:
                "Route 801 riders receive no warning during a verified escalation.",
              name: "No action",
              reversibility: "high",
            },
            {
              confidence: 0.78,
              expectedBenefit: "Adds one more observation before publication.",
              expectedRisk:
                "The fourteen-minute delay may grow before the next cycle.",
              name: "Delay until next wake",
              reversibility: "high",
            },
          ],
          selectedAction: "Publish targeted Route 801 commuter alert",
          selectionReason:
            "Two blocked lanes, heavy rain, and a fourteen-minute Route 801 delay justify a reversible targeted simulation after operator approval.",
        }),
      );
    }

    if (systemPrompt.includes("reviewer")) {
      this.revision += 1;
      if (this.revision === 1) {
        return Promise.resolve(
          JSON.stringify({
            decision: "escalate",
            explanation:
              "A second blocked lane and nine additional transit-delay minutes invalidate the initial impact assumptions.",
            newSeverity: 5,
            recheckAfterSeconds: 15,
          }),
        );
      }
      if (this.revision === 2) {
        return Promise.resolve(
          JSON.stringify({
            decision: "deescalate",
            explanation:
              "Reopened lanes, a two-minute transit delay, and weakening rain remove the escalation basis.",
            newSeverity: 2,
            recheckAfterSeconds: 15,
          }),
        );
      }
      return Promise.resolve(
        JSON.stringify({
          decision: "complete",
          explanation:
            "The final observation confirms sustained lane recovery and nominal transit conditions.",
        }),
      );
    }

    const missionId = /Mission ID:\s*\n([0-9a-f-]{36})/i.exec(userPrompt)?.[1];
    if (!missionId)
      throw new Error("Deterministic planner could not read the mission ID");
    return Promise.resolve(
      JSON.stringify({
        assumptions: [
          "Austin traffic, CapMetro, and NOAA observations are correlated to the same corridor.",
          "Publication remains a dashboard simulation behind operator approval.",
        ],
        goal: "Minimize commuter disruption around North Lamar while monitoring for escalation.",
        priority: 3,
        recheckAfterSeconds: 15,
        steps: [
          {
            arguments: { incidentId: this.incidentId, limit: 6 },
            order: 1,
            rationale: "Ground the response in comparable completed incidents.",
            requiresFreshObservation: false,
            tool: "retrieve_similar_incidents",
          },
          {
            arguments: { incidentId: this.incidentId },
            order: 2,
            rationale: "Confirm the affected rapid transit routes and delay.",
            requiresFreshObservation: false,
            tool: "find_affected_transit_routes",
          },
          {
            arguments: { incidentId: this.incidentId },
            order: 3,
            rationale: "Verify whether heavy rain amplifies clearance time.",
            requiresFreshObservation: false,
            tool: "check_weather_conditions",
          },
          {
            arguments: {
              affectedRoutes: ["801"],
              audience: "affected_routes",
              incidentId: this.incidentId,
              message:
                "Route 801 riders should prepare for disruption near North Lamar while one lane remains blocked in heavy rain.",
              severity: 3,
              title: "North Lamar disruption under monitoring",
            },
            order: 4,
            rationale:
              "Prepare a targeted alert without publishing prematurely.",
            requiresFreshObservation: false,
            tool: "create_alert_draft",
          },
          {
            arguments: { afterSeconds: 15, missionId },
            order: 5,
            rationale:
              "Re-observe live conditions before taking higher-impact action.",
            requiresFreshObservation: false,
            tool: "schedule_incident_recheck",
          },
        ],
        successCriteria: [
          "Route and weather impacts are rechecked against live evidence.",
          "Any public-facing simulation remains proportionate and operator-approved.",
          "The incident closes only after a final recovery cycle.",
        ],
      }),
    );
  }
}

class AllowingHiddenLayerFixture implements SecurityScanner {
  scan(stage: Parameters<SecurityScanner["scan"]>[0]) {
    return Promise.resolve({
      action: "allow" as const,
      blocked: false,
      details: { fixture: "deterministic-demo" },
      detections: [],
      eventId: null,
      provider: "hiddenlayer-demo-fixture",
      stage,
    });
  }
}

async function main(): Promise<void> {
  const environment = EnvironmentSchema.parse(process.env);
  const client = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const nonce = randomUUID();

  const runStage = async (
    stage: z.infer<typeof DemoStageResultSchema>["stage"],
  ) => {
    const response = (await client.rpc("run_incident_commander_demo_stage", {
      p_nonce: nonce,
      p_stage: stage,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Demo ${stage} stage failed: ${response.error.message}`);
    return DemoStageResultSchema.parse(response.data);
  };

  process.stdout.write(
    "[1/8] Replaying North Lamar collision, Route 801 delay, and heavy rain.\n",
  );
  const initial = await runStage("initial");
  const learning = new SupabaseLearningRepository(client);
  const memory = new MemoryService(
    new DeterministicEmbeddingProvider(),
    learning,
  );
  const operations = new SupabaseCommanderOperations(client, learning, memory);
  const repository = new SupabaseMissionRepository(client);
  const registry = createDefaultToolRegistry();
  const security = new AllowingHiddenLayerFixture();
  const planner = new MissionPlanner(
    new DemoNemotronModel(initial.incidentId),
    registry,
    security,
  );
  const provider = {
    getIncidentSnapshot: (incidentId: string) =>
      operations.getIncidentSnapshot(incidentId),
    getRelevantLessons: (snapshot: IncidentSnapshot, signal?: AbortSignal) =>
      operations.getRelevantLessons(snapshot, signal),
    listMissionCandidates: async (limit: number) => {
      if (limit < 1) return [];
      return [await operations.getIncidentSnapshot(initial.incidentId)];
    },
  };
  const runner = new SecureMissionToolRunner(
    registry,
    repository,
    new ToolSecurityBoundary(security),
    new OpenShellToolPolicy(),
    operations,
  );
  const engine = new MissionExecutionEngine(
    repository,
    planner,
    registry,
    provider,
    runner,
  );
  const lifecycle = new MissionLifecycleCoordinator(
    repository,
    planner,
    engine,
    provider,
    { workerId: `incident-commander-demo-${nonce}` },
  );

  await lifecycle.processBatch();
  const missionResponse = (await client
    .from("agent_missions")
    .select("id,status,plan_version")
    .eq("incident_id", initial.incidentId)
    .single()) as { data: unknown; error: { message: string } | null };
  if (missionResponse.error)
    throw new Error(`Mission lookup failed: ${missionResponse.error.message}`);
  const mission = MissionRowSchema.parse(missionResponse.data);
  process.stdout.write(
    `[2/8] Mission ${mission.id} planned, acted, and scheduled a live recheck.\n`,
  );

  await runStage("escalation");
  await lifecycle.processBatch();
  const pendingResponse = (await client
    .from("agent_tool_executions")
    .select("id")
    .eq("mission_id", mission.id)
    .eq("approval_status", "pending")
    .single()) as { data: unknown; error: { message: string } | null };
  if (pendingResponse.error)
    throw new Error(`Approval lookup failed: ${pendingResponse.error.message}`);
  const executionId = z.object({ id: z.uuid() }).parse(pendingResponse.data).id;
  process.stdout.write(
    "[3/8] Live recheck raised severity 3 → 5 and prediction 24 → 43 minutes.\n",
  );
  process.stdout.write(
    "[4/8] Mission paused at the protected publication boundary.\n",
  );

  await repository.decideToolApproval(
    executionId,
    "PulseATX Demo Operator",
    true,
  );
  await lifecycle.processBatch();
  process.stdout.write(
    "[5/8] Operator approval resumed the same mission and published the simulation.\n",
  );

  await runStage("recovery");
  await lifecycle.processBatch();
  process.stdout.write(
    "[6/8] Recheck observed reopened lanes, lower delay, and weakening rain.\n",
  );

  await runStage("final");
  await lifecycle.processBatch();
  process.stdout.write(
    "[7/8] Final cycle closed the incident and stored the reusable mission lesson.\n",
  );

  const [
    finalMissionResponse,
    alertResponse,
    outcomeResponse,
    memoryResponse,
    observationsResponse,
  ] = await Promise.all([
    client
      .from("agent_missions")
      .select("status,plan_version")
      .eq("id", mission.id)
      .single(),
    client
      .from("alerts")
      .select("status")
      .eq("incident_id", initial.incidentId)
      .single(),
    client
      .from("incident_outcomes")
      .select("actual_duration_minutes,prediction_error,outcome")
      .eq("incident_id", initial.incidentId)
      .single(),
    client
      .from("incident_memories")
      .select("lesson")
      .eq("incident_id", initial.incidentId)
      .single(),
    client
      .from("agent_observations")
      .select("state_snapshot")
      .eq("mission_id", mission.id)
      .order("created_at", { ascending: true }),
  ]);
  const failedResponse = [
    finalMissionResponse,
    alertResponse,
    outcomeResponse,
    memoryResponse,
    observationsResponse,
  ].find((response) => response.error);
  if (failedResponse?.error)
    throw new Error(
      `Final demo verification failed: ${failedResponse.error.message}`,
    );

  const finalMission = z
    .object({ plan_version: z.literal(4), status: z.literal("completed") })
    .parse(finalMissionResponse.data);
  const alert = z
    .object({ status: z.literal("published") })
    .parse(alertResponse.data);
  const outcome = z
    .object({
      actual_duration_minutes: z.literal(40),
      outcome: z.object({
        finalPredictionError: z.literal(3),
        outcome: z.literal("successful"),
        peakPredictionMinutes: z.literal(43),
      }),
      prediction_error: z.literal(3),
    })
    .parse(outcomeResponse.data);
  const storedMemory = z
    .object({ lesson: z.object({ memoryKind: z.literal("mission_lesson") }) })
    .parse(memoryResponse.data);
  const observations = z
    .array(
      z.object({
        state_snapshot: z.object({ predictedDurationMinutes: z.number() }),
      }),
    )
    .parse(observationsResponse.data);
  const result = FinalResultSchema.parse({
    actualDuration: outcome.actual_duration_minutes,
    alertStatus: alert.status,
    finalPredictionError: outcome.prediction_error,
    initialPrediction: observations[0]?.state_snapshot.predictedDurationMinutes,
    memoryKind: storedMemory.lesson.memoryKind,
    missionStatus: finalMission.status,
    planOutcome: outcome.outcome.outcome,
    planVersion: finalMission.plan_version,
    peakPrediction: outcome.outcome.peakPredictionMinutes,
  });
  process.stdout.write(`[8/8] Complete: ${JSON.stringify(result)}\n`);
  process.stdout.write(
    `Open the command center and select incident ${initial.incidentId} to inspect the live lifecycle.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Incident Commander demo failed"}\n`,
  );
  process.exitCode = 1;
});
