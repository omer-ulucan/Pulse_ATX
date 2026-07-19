import type { IncidentSnapshot } from "./tools/types.js";

const defaultMajorRoutes = new Set([
  "1",
  "7",
  "10",
  "20",
  "30",
  "300",
  "311",
  "801",
  "803",
]);

export interface MissionTriggerContext {
  alertMayBeRequired?: boolean | undefined;
  majorRoutes?: ReadonlySet<string> | undefined;
  previousSnapshot?: IncidentSnapshot | undefined;
  securityBoundaryReached?: boolean | undefined;
  snapshot: IncidentSnapshot;
}

export interface MissionTriggerDecision {
  goal: string;
  priority: number;
  qualifies: boolean;
  reason: Record<string, boolean | number | string[]>;
}

export function evaluateMissionTrigger(
  context: MissionTriggerContext,
): MissionTriggerDecision {
  const { snapshot } = context;
  const majorRoutes = context.majorRoutes ?? defaultMajorRoutes;
  const affectedMajorRoutes = snapshot.affectedRoutes.filter((route) =>
    majorRoutes.has(route.trim().toUpperCase()),
  );
  const severityChangedMaterially = context.previousSnapshot
    ? Math.abs(snapshot.severity - context.previousSnapshot.severity) >= 1
    : false;
  const conditions = {
    alertMayBeRequired:
      context.alertMayBeRequired === true || snapshot.severity >= 4,
    majorRouteAffected: affectedMajorRoutes.length > 0,
    multipleFeedsCorrelate: snapshot.correlatedFeedCount >= 2,
    predictedDurationExceeds20: snapshot.predictedDurationMinutes > 20,
    securityBoundaryReached: context.securityBoundaryReached === true,
    severityAtLeast3: snapshot.severity >= 3,
    severityChangedMaterially,
  };
  const qualifies = Object.values(conditions).some(Boolean);
  const routeScope = snapshot.affectedRoutes.length
    ? snapshot.affectedRoutes.join(", ")
    : "the affected Austin corridor";
  return {
    goal: qualifies
      ? `Minimize commuter disruption around ${routeScope} while monitoring for escalation.`
      : `Continue bounded monitoring around ${routeScope}.`,
    priority: snapshot.severity,
    qualifies,
    reason: {
      ...conditions,
      affectedMajorRoutes,
      correlatedFeedCount: snapshot.correlatedFeedCount,
      predictedDurationMinutes: snapshot.predictedDurationMinutes,
      severity: snapshot.severity,
    },
  };
}
