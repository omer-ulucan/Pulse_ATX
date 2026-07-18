import {
  buildLessonPrompt,
  buildRepairPrompt,
  INCIDENT_SYSTEM_PROMPT,
} from "@pulse-atx/prompts";
import { IncidentLessonSchema, type IncidentLesson } from "@pulse-atx/schemas";
import { z } from "zod";

import type { ChatModel } from "../models/types.js";
import {
  enforceSecurityScan,
  SecurityBlockError,
  type SecurityScanner,
} from "../security/types.js";
import type { CompletedIncident } from "./learning-repository.js";

function fallbackLesson(candidate: CompletedIncident): IncidentLesson {
  const adjustment =
    candidate.outcome.actual_duration_minutes -
    candidate.incident.predicted_duration_minutes;
  return IncidentLessonSchema.parse({
    adjustment_minutes: adjustment,
    conditions: {
      event_type: candidate.incident.incident_type,
      location_characteristics: candidate.incident.location_name
        ? [candidate.incident.location_name]
        : [],
      time_bucket: "unknown",
      weather:
        typeof candidate.outcome.outcome.weather === "string"
          ? candidate.outcome.outcome.weather
          : "unknown",
    },
    lesson: `Observed duration differed from the initial prediction by ${adjustment} minutes.`,
    recommended_action:
      "Use the observed duration when calibrating similar future incidents.",
  });
}

export class LessonExtractor {
  constructor(
    private readonly model: ChatModel,
    private readonly security?: SecurityScanner,
  ) {}

  async extract(
    candidate: CompletedIncident,
    signal?: AbortSignal,
  ): Promise<IncidentLesson> {
    const prompt = buildLessonPrompt(candidate);
    let output = "";
    let validationError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const userPrompt =
          attempt === 1 ? prompt : buildRepairPrompt(output, validationError);
        await enforceSecurityScan(
          this.security,
          "model_prompt",
          userPrompt,
          { purpose: "lesson_extraction" },
          signal,
        );
        output = await this.model.complete(
          INCIDENT_SYSTEM_PROMPT,
          userPrompt,
          signal,
        );
        await enforceSecurityScan(
          this.security,
          "model_output",
          output,
          { purpose: "lesson_extraction" },
          signal,
        );
        return IncidentLessonSchema.parse(JSON.parse(output));
      } catch (error) {
        if (error instanceof SecurityBlockError) throw error;
        validationError =
          error instanceof z.ZodError
            ? z.prettifyError(error)
            : error instanceof Error
              ? error.message
              : "Lesson extraction failed";
      }
    }
    return fallbackLesson(candidate);
  }
}
