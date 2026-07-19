import type { ImpactChange, IncidentSnapshot } from "./types.js";

function numericChange(before: number, after: number) {
  return { after, before, delta: after - before };
}

function valueChange(before: string, after: string) {
  return { after, before, changed: after !== before };
}

export function compareIncidentSnapshots(
  before: IncidentSnapshot,
  after: IncidentSnapshot,
): ImpactChange {
  const change: ImpactChange = {
    affectedRouteCount: numericChange(
      before.affectedRoutes.length,
      after.affectedRoutes.length,
    ),
    blockedLanes: numericChange(before.blockedLanes, after.blockedLanes),
    confidence: numericChange(before.confidence, after.confidence),
    geographicSpreadKm: numericChange(
      before.geographicSpreadKm,
      after.geographicSpreadKm,
    ),
    meaningful: false,
    predictedDurationMinutes: numericChange(
      before.predictedDurationMinutes,
      after.predictedDurationMinutes,
    ),
    severity: numericChange(before.severity, after.severity),
    status: valueChange(before.status, after.status),
    transitDelayMinutes: numericChange(
      before.transitDelayMinutes,
      after.transitDelayMinutes,
    ),
    weatherSeverity: valueChange(before.weatherSeverity, after.weatherSeverity),
  };
  change.meaningful =
    Math.abs(change.severity.delta) >= 1 ||
    Math.abs(change.blockedLanes.delta) >= 1 ||
    Math.abs(change.transitDelayMinutes.delta) >= 3 ||
    Math.abs(change.affectedRouteCount.delta) >= 1 ||
    Math.abs(change.predictedDurationMinutes.delta) >= 5 ||
    Math.abs(change.confidence.delta) >= 0.15 ||
    Math.abs(change.geographicSpreadKm.delta) >= 0.5 ||
    change.status.changed ||
    change.weatherSeverity.changed;
  return change;
}
