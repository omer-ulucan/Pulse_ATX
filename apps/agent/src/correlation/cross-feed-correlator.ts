import { EventSourceSchema } from "@pulse-atx/schemas";

import type {
  CorrelationCandidate,
  CorrelationDecision,
  CorrelationJob,
  CorrelationSignal,
  CrossFeedRepository,
} from "./types.js";

const MAX_TIME_DIFFERENCE_MINUTES = 120;
const WEATHER_RADIUS_KM = 80;
const LOCAL_RADIUS_KM = 5;

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function routeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function summaryFromPayload(payload: Record<string, unknown>): string {
  for (const key of [
    "header",
    "headline",
    "issue_reported",
    "description",
    "event",
  ]) {
    const value = stringValue(payload[key]);
    if (value) return value;
  }
  return "Cross-feed city signal";
}

export function signalFromJob(job: CorrelationJob): CorrelationSignal | null {
  const occurredAt =
    job.sourceUpdatedAt ??
    stringValue(job.payload.sent) ??
    stringValue(job.payload.effective) ??
    stringValue(job.payload.published_date);
  if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) return null;
  const source = EventSourceSchema.safeParse(job.source);
  if (!source.success) return null;
  return {
    durationDeltaMinutes: Math.max(
      0,
      Math.round(numberValue(job.payload.transit_delay_minutes) ?? 0),
    ),
    eventType: job.eventType,
    latitude: numberValue(job.payload.latitude),
    locationName:
      stringValue(job.payload.address) ??
      stringValue(job.payload.areaDesc) ??
      stringValue(job.payload.location_name),
    longitude: numberValue(job.payload.longitude),
    occurredAt: new Date(occurredAt).toISOString(),
    routeIds: routeIds(job.payload.route_ids),
    severity: Math.max(
      1,
      Math.min(5, Math.round(numberValue(job.payload.severity_score) ?? 1)),
    ),
    source: source.data,
    summary: summaryFromPayload(job.payload),
  };
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceKm(
  first: Pick<CorrelationSignal, "latitude" | "longitude">,
  second: Pick<CorrelationSignal, "latitude" | "longitude">,
): number | null {
  if (
    first.latitude === null ||
    first.longitude === null ||
    second.latitude === null ||
    second.longitude === null
  ) {
    return null;
  }
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function tokens(signal: CorrelationSignal): Set<string> {
  const ignored = new Set([
    "alert",
    "austin",
    "blvd",
    "road",
    "route",
    "street",
  ]);
  return new Set(
    `${signal.locationName ?? ""} ${signal.summary}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function overlapCount(first: Set<string>, second: Set<string>): number {
  return [...first].filter((token) => second.has(token)).length;
}

function evaluateCandidate(
  incoming: CorrelationSignal,
  candidate: CorrelationCandidate,
): CorrelationDecision | null {
  if (incoming.source === candidate.signal.source) return null;
  const timeDifferenceMinutes =
    Math.abs(
      new Date(incoming.occurredAt).getTime() -
        new Date(candidate.signal.occurredAt).getTime(),
    ) / 60_000;
  if (timeDifferenceMinutes > MAX_TIME_DIFFERENCE_MINUTES) return null;

  const distanceKm = haversineDistanceKm(incoming, candidate.signal);
  const tokenOverlap = overlapCount(tokens(incoming), tokens(candidate.signal));
  const routeOverlap = incoming.routeIds.some((route) =>
    candidate.signal.routeIds.includes(route),
  );
  const isWeather =
    incoming.source === "noaa_weather" ||
    candidate.signal.source === "noaa_weather";
  const spatialLimit = isWeather ? WEATHER_RADIUS_KM : LOCAL_RADIUS_KM;
  const spatialMatch = distanceKm !== null && distanceKm <= spatialLimit;
  const semanticMatch = routeOverlap || tokenOverlap >= 2;
  if (!spatialMatch && !semanticMatch) return null;

  const temporalScore = 1 - timeDifferenceMinutes / MAX_TIME_DIFFERENCE_MINUTES;
  const spatialScore =
    distanceKm === null ? 0 : Math.max(0, 1 - distanceKm / spatialLimit);
  const semanticScore = routeOverlap ? 1 : Math.min(1, tokenOverlap / 3);
  const score = Number(
    (temporalScore * 0.4 + spatialScore * 0.4 + semanticScore * 0.2).toFixed(4),
  );
  if (score < 0.5) return null;

  const weatherDelta = isWeather ? (incoming.severity >= 4 ? 30 : 15) : 0;
  const transitDelta = incoming.durationDeltaMinutes;
  const durationMinutes = Math.min(
    1_440,
    Math.max(
      candidate.predictedDurationMinutes,
      candidate.predictedDurationMinutes + weatherDelta + transitDelta,
    ),
  );
  const severity = Math.min(
    5,
    Math.max(
      candidate.severity,
      incoming.severity,
      isWeather && incoming.severity >= 4
        ? candidate.severity + 1
        : candidate.severity,
    ),
  );
  const reasons = [
    `signals occurred ${timeDifferenceMinutes.toFixed(1)} minutes apart`,
  ];
  if (spatialMatch && distanceKm !== null)
    reasons.push(`signals are ${distanceKm.toFixed(2)} km apart`);
  if (routeOverlap) reasons.push("affected transit route overlaps");
  if (tokenOverlap >= 2) reasons.push(`${tokenOverlap} location terms overlap`);

  return {
    candidateIncidentId: candidate.incidentId,
    distanceKm,
    durationMinutes,
    reasons,
    score,
    severity,
    timeDifferenceMinutes,
  };
}

export function correlateSignals(
  incoming: CorrelationSignal,
  candidates: CorrelationCandidate[],
): CorrelationDecision | null {
  return (
    candidates
      .map((candidate) => evaluateCandidate(incoming, candidate))
      .filter((decision): decision is CorrelationDecision => decision !== null)
      .sort((first, second) => second.score - first.score)[0] ?? null
  );
}

export class CrossFeedCorrelationService {
  constructor(private readonly repository: CrossFeedRepository) {}

  async correlate(
    job: CorrelationJob,
    workerId: string,
  ): Promise<string | null> {
    const signal = signalFromJob(job);
    if (!signal) return null;
    const decision = correlateSignals(
      signal,
      await this.repository.listCorrelationCandidates(job.rawEventId),
    );
    if (!decision) return null;
    return this.repository.persistCorrelation(workerId, job, decision);
  }
}
