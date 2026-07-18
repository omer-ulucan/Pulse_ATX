import type { FeedAdapter } from "../feeds/types.js";
import type { EventRepository } from "../repositories/event-repository.js";

export interface PollSummary {
  changed: number;
  received: number;
}

export class IngestionService {
  constructor(
    private readonly adapter: FeedAdapter,
    private readonly repository: EventRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async poll(signal?: AbortSignal): Promise<PollSummary> {
    const startedAt = performance.now();
    const polledAt = this.now().toISOString();
    try {
      const result = await this.adapter.poll(signal);
      let changed = 0;
      for (const event of result.events) {
        const ingested = await this.repository.ingestEvent(event);
        if (ingested.changed) changed += 1;
      }
      await this.repository.recordSourceHealth({
        etag: result.etag,
        itemsChanged: changed,
        itemsReceived: result.events.length,
        lastError: null,
        lastModified: result.lastModified,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        polledAt,
        source: this.adapter.source,
        status: "healthy",
      });
      return { changed, received: result.events.length };
    } catch (error) {
      await this.repository.recordSourceHealth({
        etag: null,
        itemsChanged: 0,
        itemsReceived: 0,
        lastError:
          error instanceof Error ? error.message : "Unknown feed error",
        lastModified: null,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        polledAt,
        source: this.adapter.source,
        status: "degraded",
      });
      throw error;
    }
  }
}
