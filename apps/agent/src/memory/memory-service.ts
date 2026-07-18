import type { IncidentLesson } from "@pulse-atx/schemas";

import type { EmbeddingProvider } from "./embedding-client.js";
import type {
  LearningRepository,
  MemoryMatch,
  MemoryQuery,
} from "./learning-repository.js";
import type { LessonExtractor } from "./lesson-extractor.js";

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function timeBucket(value: unknown): MemoryQuery["timeBucket"] {
  if (typeof value !== "string") return "unknown";
  const hour = new Date(value).getUTCHours();
  if (Number.isNaN(hour)) return "unknown";
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "overnight";
}

function memoryText(event: Record<string, unknown>): string {
  return JSON.stringify({
    eventType: event.event_type,
    location: event.address ?? event.location_name,
    route: event.route_id ?? event.route,
    status: event.status,
    summary: event.issue_reported ?? event.description ?? event.summary,
    weather: event.weather,
  });
}

export class MemoryService {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly repository: LearningRepository,
    private readonly lessons: LessonExtractor,
  ) {}

  async retrieveForEvent(
    event: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const embedding = await this.embeddings.embed(memoryText(event), signal);
    const matches = await this.repository.retrieveSimilar(
      {
        embedding,
        incidentType:
          typeof event.event_type === "string" ? event.event_type : null,
        latitude: numericValue(event.latitude),
        longitude: numericValue(event.longitude),
        timeBucket: timeBucket(event.source_updated_at),
      },
      6,
    );
    return matches.map((match: MemoryMatch) => ({
      combinedScore: match.combinedScore,
      incidentId: match.incidentId,
      lesson: match.lesson,
      memoryId: match.memoryId,
      similarity: match.similarity,
      summary: match.summary,
    }));
  }

  async consolidateCompleted(limit = 4, signal?: AbortSignal): Promise<number> {
    const candidates = await this.repository.listMemoryCandidates(limit);
    for (const candidate of candidates) {
      const lesson: IncidentLesson = await this.lessons.extract(
        candidate,
        signal,
      );
      const summary = `${candidate.incident.title}. Actual duration ${candidate.outcome.actual_duration_minutes} minutes. ${lesson.lesson}`;
      const embedding = await this.embeddings.embed(summary, signal);
      const denominator = Math.max(
        1,
        candidate.outcome.actual_duration_minutes,
      );
      const qualityScore = Math.max(
        0.5,
        1 - Math.min(1, candidate.outcome.prediction_error / denominator) * 0.4,
      );
      await this.repository.storeMemory({
        embedding,
        incidentId: candidate.incident.id,
        lesson,
        qualityScore,
        summary,
      });
    }
    return candidates.length;
  }
}
