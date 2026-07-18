import { randomUUID } from "node:crypto";

import type { NormalizedEvent } from "@pulse-atx/schemas";

import type {
  EventRepository,
  IngestResult,
  SourceHealthUpdate,
} from "./event-repository.js";

interface StoredEvent {
  event: NormalizedEvent;
  id: string;
  revision: number;
}

export interface MemoryJob {
  id: string;
  rawEventId: string;
  revision: number;
}

export class MemoryEventRepository implements EventRepository {
  readonly events = new Map<string, StoredEvent>();
  readonly jobs: MemoryJob[] = [];
  readonly sourceHealth = new Map<string, SourceHealthUpdate>();

  ingestEvent(event: NormalizedEvent): Promise<IngestResult> {
    const key = `${event.source}:${event.externalId}`;
    const existing = this.events.get(key);
    if (existing?.event.fingerprint === event.fingerprint) {
      return Promise.resolve({
        changed: false,
        jobId: null,
        rawEventId: existing.id,
        revision: existing.revision,
      });
    }

    const stored: StoredEvent = {
      event,
      id: existing?.id ?? randomUUID(),
      revision: (existing?.revision ?? 0) + 1,
    };
    this.events.set(key, stored);
    const job = {
      id: randomUUID(),
      rawEventId: stored.id,
      revision: stored.revision,
    };
    this.jobs.push(job);
    return Promise.resolve({
      changed: true,
      jobId: job.id,
      rawEventId: stored.id,
      revision: stored.revision,
    });
  }

  recordSourceHealth(update: SourceHealthUpdate): Promise<void> {
    this.sourceHealth.set(update.source, update);
    return Promise.resolve();
  }
}
