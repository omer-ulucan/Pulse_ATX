import {
  buildIncidentPrompt,
  buildRepairPrompt,
  INCIDENT_SYSTEM_PROMPT,
  PROMPT_VERSIONS,
} from "@pulse-atx/prompts";
import {
  IncidentDecisionSchema,
  type IncidentDecision,
} from "@pulse-atx/schemas";
import { z } from "zod";

import { InferenceMetrics, type ChatModel } from "../models/types.js";

export interface AnalysisContext {
  event: Record<string, unknown>;
  nearbySignals?: Record<string, unknown>[];
  retrievedMemories?: Record<string, unknown>[];
}

export interface AnalysisResult {
  attempts: number;
  decision: IncidentDecision;
  inputContext: Record<string, unknown>;
  latencyMs: number;
  modelName: string;
  promptVersion: string;
  usedFallback: boolean;
  validationFailures: string[];
}

function parseDecision(output: string): IncidentDecision {
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
  return IncidentDecisionSchema.parse(JSON.parse(json));
}

function fallbackDecision(event: Record<string, unknown>): IncidentDecision {
  const description = [
    event.issue_reported,
    event.description,
    event.summary,
    event.event_type,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const normalized = description.toLowerCase();
  const severity = /fatal|explosion|citywide|hazmat/.test(normalized)
    ? 5
    : /injury|blocked|flood|severe/.test(normalized)
      ? 4
      : /collision|closure|warning|delay/.test(normalized)
        ? 3
        : 2;
  const location =
    typeof event.address === "string"
      ? event.address
      : typeof event.location_name === "string"
        ? event.location_name
        : null;
  const baseDuration = severity >= 4 ? 45 : severity === 3 ? 30 : 15;
  return IncidentDecisionSchema.parse({
    affected_entities: location ? [{ name: location, type: "road" }] : [],
    confidence: 0.45,
    evidence: [description || "Validated city feed event"],
    incident_type:
      typeof event.event_type === "string"
        ? event.event_type
        : "unknown_city_event",
    memory_effect: {
      adjusted_prediction_minutes: baseDuration,
      base_prediction_minutes: baseDuration,
      similar_incident_count: 0,
      used_historical_memory: false,
    },
    predicted_duration_minutes: baseDuration,
    recommended_actions: ["Continue monitoring verified city feeds"],
    requires_human_approval: severity >= 5,
    severity,
    summary: description || "A city event requires operator review.",
    title: location ? `City event near ${location}` : "New city event detected",
  });
}

export class NemotronAnalyzer {
  readonly metrics: InferenceMetrics;

  constructor(
    private readonly model: ChatModel,
    metrics?: InferenceMetrics,
  ) {
    this.metrics = metrics ?? new InferenceMetrics(model.modelName);
  }

  async analyze(
    context: AnalysisContext,
    signal?: AbortSignal,
  ): Promise<AnalysisResult> {
    const inputContext = {
      event: context.event,
      nearbySignals: context.nearbySignals ?? [],
      retrievedMemories: context.retrievedMemories ?? [],
    };
    const prompt = buildIncidentPrompt(inputContext);
    const validationFailures: string[] = [];
    const startedAt = performance.now();
    let previousOutput = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const userPrompt =
          attempt === 2 && previousOutput
            ? buildRepairPrompt(
                previousOutput,
                validationFailures.at(-1) ?? "Invalid JSON",
              )
            : prompt;
        previousOutput = await this.model.complete(
          INCIDENT_SYSTEM_PROMPT,
          userPrompt,
          signal,
        );
        const decision = parseDecision(previousOutput);
        this.metrics.recordStructuredOutput(true);
        return {
          attempts: attempt,
          decision,
          inputContext,
          latencyMs: Math.round(performance.now() - startedAt),
          modelName: this.model.modelName,
          promptVersion: PROMPT_VERSIONS.incidentAnalysis,
          usedFallback: false,
          validationFailures,
        };
      } catch (error) {
        validationFailures.push(
          error instanceof z.ZodError
            ? z.prettifyError(error)
            : error instanceof Error
              ? error.message
              : "Unknown model failure",
        );
      }
    }

    this.metrics.recordStructuredOutput(false);
    return {
      attempts: 2,
      decision: fallbackDecision(context.event),
      inputContext,
      latencyMs: Math.round(performance.now() - startedAt),
      modelName: this.model.modelName,
      promptVersion: PROMPT_VERSIONS.incidentAnalysis,
      usedFallback: true,
      validationFailures,
    };
  }
}
