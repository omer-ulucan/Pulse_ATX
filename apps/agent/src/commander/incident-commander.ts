import type { MissionExecutionEngine } from "./mission-engine.js";
import type { MissionRecord, MissionRepository } from "./mission-repository.js";
import {
  evaluateMissionTrigger,
  type MissionTriggerContext,
} from "./mission-trigger.js";

export class IncidentCommander {
  constructor(
    private readonly repository: MissionRepository,
    private readonly engine: MissionExecutionEngine,
  ) {}

  async observeIncident(
    context: MissionTriggerContext,
    signal?: AbortSignal,
  ): Promise<MissionRecord | null> {
    const decision = evaluateMissionTrigger(context);
    if (!decision.qualifies) return null;

    const creation = await this.repository.createMission({
      goal: decision.goal,
      incidentId: context.snapshot.incidentId,
      priority: decision.priority,
      triggerReason: decision.reason,
    });
    if (creation.created) {
      await this.repository.appendTimeline({
        eventType: "mission_created",
        incidentId: creation.mission.incidentId,
        message: "Mission created",
        metadata: {
          priority: creation.mission.priority,
          triggerReason: creation.mission.triggerReason,
        },
        missionId: creation.mission.id,
      });
    }
    const result = await this.engine.processMission(
      creation.mission.id,
      signal,
    );
    return result.mission;
  }
}
