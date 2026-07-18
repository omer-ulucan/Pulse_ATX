import type { EventSource } from "@pulse-atx/schemas";

export interface CorrelationSignal {
  durationDeltaMinutes: number;
  eventType: string;
  latitude: number | null;
  locationName: string | null;
  longitude: number | null;
  occurredAt: string;
  routeIds: string[];
  severity: number;
  source: EventSource;
  summary: string;
}

export interface CorrelationCandidate {
  incidentId: string;
  predictedDurationMinutes: number;
  severity: number;
  signal: CorrelationSignal;
}

export interface CorrelationDecision {
  candidateIncidentId: string;
  distanceKm: number | null;
  durationMinutes: number;
  reasons: string[];
  score: number;
  severity: number;
  timeDifferenceMinutes: number;
}

export interface CorrelationJob {
  eventType: string;
  id: string;
  payload: Record<string, unknown>;
  rawEventId: string;
  source: string;
  sourceUpdatedAt: string | null;
}

export interface CrossFeedRepository {
  listCorrelationCandidates(
    rawEventId: string,
  ): Promise<CorrelationCandidate[]>;
  persistCorrelation(
    workerId: string,
    job: CorrelationJob,
    decision: CorrelationDecision,
  ): Promise<string>;
}
