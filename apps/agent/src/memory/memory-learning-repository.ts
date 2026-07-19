import { randomUUID } from "node:crypto";

import type {
  CompletedIncident,
  LearningRepository,
  MemoryMatch,
  MemoryQuery,
  StoredMemory,
} from "./learning-repository.js";

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export class MemoryLearningRepository implements LearningRepository {
  readonly candidates: CompletedIncident[] = [];
  readonly memories: (StoredMemory & { id: string })[] = [];
  readonly outcomes: {
    actualDurationMinutes: number;
    incidentId: string;
    observedSeverity: number;
    outcome: Record<string, unknown>;
  }[] = [];

  listMemoryCandidates(limit: number): Promise<CompletedIncident[]> {
    const storedIds = new Set(this.memories.map((memory) => memory.incidentId));
    return Promise.resolve(
      this.candidates
        .filter((candidate) => !storedIds.has(candidate.incident.id))
        .slice(0, limit),
    );
  }

  recordOutcome(
    incidentId: string,
    actualDurationMinutes: number,
    observedSeverity: number,
    outcome: Record<string, unknown>,
  ): Promise<string> {
    this.outcomes.push({
      actualDurationMinutes,
      incidentId,
      observedSeverity,
      outcome,
    });
    return Promise.resolve(randomUUID());
  }

  retrieveSimilar(query: MemoryQuery, limit: number): Promise<MemoryMatch[]> {
    return Promise.resolve(
      this.memories
        .map((memory) => ({
          memory,
          similarity: cosineSimilarity(query.embedding, memory.embedding),
        }))
        .filter(({ memory, similarity }) => {
          const conditions = memory.lesson.conditions;
          const lessonType =
            typeof conditions === "object" &&
            conditions !== null &&
            "event_type" in conditions &&
            typeof conditions.event_type === "string"
              ? conditions.event_type
              : null;
          return (
            similarity >= 0.45 &&
            (!query.incidentType || lessonType === query.incidentType)
          );
        })
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, limit)
        .map(({ memory, similarity }) => ({
          combinedScore: similarity,
          incidentId: memory.incidentId,
          lesson: memory.lesson,
          memoryId: memory.id,
          similarity,
          summary: memory.summary,
        })),
    );
  }

  storeMemory(memory: StoredMemory): Promise<string> {
    const existing = this.memories.find(
      (item) => item.incidentId === memory.incidentId,
    );
    if (existing) Object.assign(existing, memory);
    else this.memories.push({ ...memory, id: randomUUID() });
    return Promise.resolve(
      existing?.id ?? this.memories.at(-1)?.id ?? randomUUID(),
    );
  }
}
