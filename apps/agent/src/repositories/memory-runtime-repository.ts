import type {
  AgentHealthUpdate,
  QueueMetrics,
  RuntimeRepository,
} from "./runtime-repository.js";

export interface MemoryTimelineEntry {
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
}

export class MemoryRuntimeRepository implements RuntimeRepository {
  health: AgentHealthUpdate | null = null;
  metrics: QueueMetrics = { activeIncidents: 0, pendingJobs: 0 };
  staleJobs = 0;
  readonly timeline: MemoryTimelineEntry[] = [];

  appendTimeline(
    eventType: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    this.timeline.push({ eventType, message, metadata });
    return Promise.resolve();
  }

  getQueueMetrics(): Promise<QueueMetrics> {
    return Promise.resolve(this.metrics);
  }

  recoverStaleJobs(staleBefore: string): Promise<number> {
    void staleBefore;
    const recovered = this.staleJobs;
    this.staleJobs = 0;
    return Promise.resolve(recovered);
  }

  updateAgentHealth(update: AgentHealthUpdate): Promise<void> {
    this.health = update;
    return Promise.resolve();
  }
}
