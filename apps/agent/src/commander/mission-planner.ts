import {
  buildCounterfactualPrompt,
  buildMissionPlanPrompt,
  buildMissionRevisionPrompt,
  buildRepairPrompt,
  COUNTERFACTUAL_SYSTEM_PROMPT,
  MISSION_REVISION_SYSTEM_PROMPT,
  MISSION_SYSTEM_PROMPT,
  PROMPT_VERSIONS,
} from "@pulse-atx/prompts";
import { z } from "zod";

import type { ChatModel } from "../models/types.js";
import {
  enforceSecurityScan,
  SecurityBlockError,
  type SecurityScanner,
} from "../security/types.js";
import {
  CounterfactualAuditSchema,
  MissionPlanSchema,
  MissionRevisionSchema,
  type CounterfactualAudit,
  type MissionPlan,
  type MissionRevision,
  type MissionStep,
} from "./mission-schemas.js";
import type { AgentToolRegistry } from "./tools/registry.js";
import type { ImpactChange, IncidentSnapshot } from "./tools/types.js";

export interface MissionPlanningContext {
  incidentSnapshot: IncidentSnapshot;
  missionId: string;
  relevantLessons: Record<string, unknown>[];
  triggerReason: Record<string, unknown>;
}

export interface MissionPlanResult {
  attempts: number;
  plan: MissionPlan;
  promptVersion: string;
  usedFallback: boolean;
  validationFailures: string[];
}

export interface MissionRevisionContext {
  changeSummary: ImpactChange;
  currentPlan: MissionPlan;
  currentSnapshot: IncidentSnapshot;
  priorSnapshot: IncidentSnapshot;
}

export interface MissionRevisionResult {
  attempts: number;
  promptVersion: string;
  revision: MissionRevision;
  usedFallback: boolean;
  validationFailures: string[];
}

export interface CounterfactualContext {
  incidentSnapshot: IncidentSnapshot;
  step: MissionStep;
}

export interface CounterfactualResult {
  attempts: number;
  audit: CounterfactualAudit;
  promptVersion: string;
  usedFallback: boolean;
  validationFailures: string[];
}

function parseJsonObject(output: string): unknown {
  const withoutFence = output
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const json =
    firstBrace >= 0 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;
  return JSON.parse(json);
}

function failureMessage(error: unknown): string {
  return error instanceof z.ZodError
    ? z.prettifyError(error)
    : error instanceof Error
      ? error.message
      : "Unknown structured-output failure";
}

function fallbackPlan(context: MissionPlanningContext): MissionPlan {
  const snapshot = context.incidentSnapshot;
  const routeLabel = snapshot.affectedRoutes.length
    ? snapshot.affectedRoutes.join(", ")
    : "affected corridors";
  return MissionPlanSchema.parse({
    assumptions: [
      "The correlated city-feed snapshot is current at mission creation.",
      "Publication remains simulated and requires explicit operator approval.",
    ],
    goal: `Minimize commuter disruption around the active incident while monitoring ${routeLabel} for escalation.`,
    priority: snapshot.severity,
    recheckAfterSeconds: 60,
    steps: [
      {
        arguments: { incidentId: snapshot.incidentId, limit: 6 },
        order: 1,
        rationale:
          "Ground duration and response choices in comparable outcomes.",
        requiresFreshObservation: false,
        tool: "retrieve_similar_incidents",
      },
      {
        arguments: { incidentId: snapshot.incidentId },
        order: 2,
        rationale: "Confirm which correlated transit routes face disruption.",
        requiresFreshObservation: false,
        tool: "find_affected_transit_routes",
      },
      {
        arguments: { incidentId: snapshot.incidentId },
        order: 3,
        rationale: "Verify whether current weather amplifies clearance time.",
        requiresFreshObservation: false,
        tool: "check_weather_conditions",
      },
      {
        arguments: {
          affectedRoutes: snapshot.affectedRoutes,
          audience: "affected_routes",
          incidentId: snapshot.incidentId,
          message: `Expect delays near the active incident affecting ${routeLabel}. PulseATX is monitoring lane and transit conditions.`,
          severity: snapshot.severity,
          title: "Active corridor disruption under monitoring",
        },
        order: 4,
        rationale:
          "Prepare a targeted alert without publishing it prematurely.",
        requiresFreshObservation: false,
        tool: "create_alert_draft",
      },
      {
        arguments: { afterSeconds: 60, missionId: context.missionId },
        order: 5,
        rationale: "Re-observe live feeds before committing further action.",
        requiresFreshObservation: false,
        tool: "schedule_incident_recheck",
      },
    ],
    successCriteria: [
      "Live traffic, transit, and weather effects are rechecked.",
      "Any commuter alert remains proportionate to verified impact.",
      "The incident is closed only after recovery is observed.",
    ],
  });
}

function fallbackRevision(context: MissionRevisionContext): MissionRevision {
  const change = context.changeSummary;
  const severityDelta = change.severity.delta;
  if (context.currentSnapshot.status === "resolved") {
    return {
      decision: "complete",
      explanation: "The fresh incident snapshot is resolved.",
    };
  }
  if (severityDelta >= 1 || change.transitDelayMinutes.delta >= 5) {
    return {
      decision: "escalate",
      explanation:
        "Deterministic severity or transit-delay growth invalidates the prior impact assumption.",
      newSeverity: context.currentSnapshot.severity,
      recheckAfterSeconds: 60,
    };
  }
  if (severityDelta <= -1 || change.blockedLanes.delta < 0) {
    return {
      decision: "deescalate",
      explanation:
        "Fresh lane and severity evidence shows material operational improvement.",
      newSeverity: context.currentSnapshot.severity,
      recheckAfterSeconds: 60,
    };
  }
  return {
    decision: "continue",
    explanation:
      "No material deterministic change requires a new plan version.",
    recheckAfterSeconds: context.currentPlan.recheckAfterSeconds,
  };
}

function fallbackAudit(context: CounterfactualContext): CounterfactualAudit {
  return CounterfactualAuditSchema.parse({
    alternatives: [
      {
        confidence: 0.82,
        expectedBenefit: "Avoids unnecessary intervention if impact clears.",
        expectedRisk: "Verified disruption may worsen before the next cycle.",
        name: "No action",
        reversibility: "high",
      },
      {
        confidence: 0.76,
        expectedBenefit:
          "Collects one additional live observation before acting.",
        expectedRisk: "Delays a time-sensitive response to current evidence.",
        name: "Delay until the next wake",
        reversibility: "high",
      },
    ],
    selectedAction: `${context.step.tool}: ${context.step.rationale}`,
    selectionReason:
      "The bounded action addresses verified impact while policy and approval controls preserve the human boundary.",
  });
}

export class MissionPlanner {
  constructor(
    private readonly model: ChatModel,
    private readonly registry: AgentToolRegistry,
    private readonly security?: SecurityScanner,
  ) {}

  private toolCatalog(): Array<{ description: string; name: string }> {
    return this.registry.names().map((name) => ({
      description: this.registry.resolve(name).definition.description,
      name,
    }));
  }

  private validatePlan(value: unknown): MissionPlan {
    const plan = MissionPlanSchema.parse(value);
    const normalizedSteps = plan.steps.map((step) => {
      const call = this.registry.validateCall({
        arguments: step.arguments,
        tool: step.tool,
      });
      return { ...step, arguments: call.arguments };
    });
    return MissionPlanSchema.parse({ ...plan, steps: normalizedSteps });
  }

  async createPlan(
    context: MissionPlanningContext,
    signal?: AbortSignal,
  ): Promise<MissionPlanResult> {
    const prompt = buildMissionPlanPrompt({
      ...context,
      toolCatalog: this.toolCatalog(),
    });
    const validationFailures: string[] = [];
    let previousOutput = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const userPrompt =
          attempt === 1
            ? prompt
            : buildRepairPrompt(
                previousOutput,
                validationFailures.at(-1) ?? "Invalid mission plan",
              );
        await enforceSecurityScan(
          this.security,
          "model_prompt",
          userPrompt,
          { attempt, operation: "mission_plan" },
          signal,
        );
        previousOutput = await this.model.complete(
          MISSION_SYSTEM_PROMPT,
          userPrompt,
          signal,
        );
        await enforceSecurityScan(
          this.security,
          "model_output",
          previousOutput,
          { attempt, operation: "mission_plan" },
          signal,
        );
        return {
          attempts: attempt,
          plan: this.validatePlan(parseJsonObject(previousOutput)),
          promptVersion: PROMPT_VERSIONS.missionPlan,
          usedFallback: false,
          validationFailures,
        };
      } catch (error) {
        if (error instanceof SecurityBlockError) throw error;
        validationFailures.push(failureMessage(error));
      }
    }

    return {
      attempts: 2,
      plan: fallbackPlan(context),
      promptVersion: PROMPT_VERSIONS.missionPlan,
      usedFallback: true,
      validationFailures,
    };
  }

  async revisePlan(
    context: MissionRevisionContext,
    signal?: AbortSignal,
  ): Promise<MissionRevisionResult> {
    const prompt = buildMissionRevisionPrompt({
      ...context,
      toolCatalog: this.toolCatalog(),
    });
    const validationFailures: string[] = [];
    let previousOutput = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const userPrompt =
          attempt === 1
            ? prompt
            : buildRepairPrompt(
                previousOutput,
                validationFailures.at(-1) ?? "Invalid mission revision",
              );
        await enforceSecurityScan(
          this.security,
          "model_prompt",
          userPrompt,
          { attempt, operation: "mission_revision" },
          signal,
        );
        previousOutput = await this.model.complete(
          MISSION_REVISION_SYSTEM_PROMPT,
          userPrompt,
          signal,
        );
        await enforceSecurityScan(
          this.security,
          "model_output",
          previousOutput,
          { attempt, operation: "mission_revision" },
          signal,
        );
        const revision = MissionRevisionSchema.parse(
          parseJsonObject(previousOutput),
        );
        if (revision.replacementSteps) {
          for (const step of revision.replacementSteps) {
            this.registry.validateCall({
              arguments: step.arguments,
              tool: step.tool,
            });
          }
        }
        return {
          attempts: attempt,
          promptVersion: PROMPT_VERSIONS.missionRevision,
          revision,
          usedFallback: false,
          validationFailures,
        };
      } catch (error) {
        if (error instanceof SecurityBlockError) throw error;
        validationFailures.push(failureMessage(error));
      }
    }

    return {
      attempts: 2,
      promptVersion: PROMPT_VERSIONS.missionRevision,
      revision: fallbackRevision(context),
      usedFallback: true,
      validationFailures,
    };
  }

  async auditAction(
    context: CounterfactualContext,
    signal?: AbortSignal,
  ): Promise<CounterfactualResult> {
    const prompt = buildCounterfactualPrompt({
      incidentSnapshot: context.incidentSnapshot,
      proposedAction: {
        arguments: context.step.arguments,
        tool: context.step.tool,
      },
      rationale: context.step.rationale,
    });
    const validationFailures: string[] = [];
    let previousOutput = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const userPrompt =
          attempt === 1
            ? prompt
            : buildRepairPrompt(
                previousOutput,
                validationFailures.at(-1) ?? "Invalid decision audit",
              );
        await enforceSecurityScan(
          this.security,
          "model_prompt",
          userPrompt,
          { attempt, operation: "counterfactual_audit" },
          signal,
        );
        previousOutput = await this.model.complete(
          COUNTERFACTUAL_SYSTEM_PROMPT,
          userPrompt,
          signal,
        );
        await enforceSecurityScan(
          this.security,
          "model_output",
          previousOutput,
          { attempt, operation: "counterfactual_audit" },
          signal,
        );
        return {
          attempts: attempt,
          audit: CounterfactualAuditSchema.parse(
            parseJsonObject(previousOutput),
          ),
          promptVersion: PROMPT_VERSIONS.missionCounterfactual,
          usedFallback: false,
          validationFailures,
        };
      } catch (error) {
        if (error instanceof SecurityBlockError) throw error;
        validationFailures.push(failureMessage(error));
      }
    }

    return {
      attempts: 2,
      audit: fallbackAudit(context),
      promptVersion: PROMPT_VERSIONS.missionCounterfactual,
      usedFallback: true,
      validationFailures,
    };
  }
}
