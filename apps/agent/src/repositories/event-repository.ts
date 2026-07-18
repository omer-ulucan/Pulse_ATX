import type { Json } from "@pulse-atx/database-types";
import type { EventSource, NormalizedEvent } from "@pulse-atx/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const IngestRowSchema = z.object({
  changed: z.boolean(),
  job_id: z.uuid().nullable(),
  raw_event_id: z.uuid(),
  revision: z.number().int().positive(),
});

export interface IngestResult {
  changed: boolean;
  jobId: string | null;
  rawEventId: string;
  revision: number;
}

export interface SourceHealthUpdate {
  etag: string | null;
  itemsChanged: number;
  itemsReceived: number;
  lastError: string | null;
  lastModified: string | null;
  latencyMs: number;
  polledAt: string;
  source: EventSource;
  status: "degraded" | "healthy" | "offline";
}

export interface EventRepository {
  ingestEvent(event: NormalizedEvent): Promise<IngestResult>;
  recordSourceHealth(update: SourceHealthUpdate): Promise<void>;
}

export class SupabaseEventRepository implements EventRepository {
  constructor(private readonly client: SupabaseClient) {}

  async ingestEvent(event: NormalizedEvent): Promise<IngestResult> {
    const response = (await this.client.rpc("ingest_raw_event", {
      p_event_type: event.eventType,
      p_external_id: event.externalId,
      p_fingerprint: event.fingerprint,
      p_payload: event.payload as Json,
      p_source: event.source,
      p_source_created_at: event.sourceCreatedAt,
      p_source_updated_at: event.sourceUpdatedAt,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error) {
      throw new Error(`Supabase ingestion failed: ${response.error.message}`);
    }
    const row = IngestRowSchema.parse(
      Array.isArray(response.data) ? response.data[0] : response.data,
    );
    return {
      changed: row.changed,
      jobId: row.job_id,
      rawEventId: row.raw_event_id,
      revision: row.revision,
    };
  }

  async recordSourceHealth(update: SourceHealthUpdate): Promise<void> {
    const response = (await this.client.from("source_health").upsert(
      {
        etag: update.etag,
        items_changed: update.itemsChanged,
        items_received: update.itemsReceived,
        last_error: update.lastError,
        last_error_at: update.lastError ? update.polledAt : null,
        last_modified: update.lastModified,
        last_poll_at: update.polledAt,
        last_success_at: update.status === "healthy" ? update.polledAt : null,
        latency_ms: update.latencyMs,
        source: update.source,
        status: update.status,
      },
      { onConflict: "source" },
    )) as { error: { message: string } | null };
    if (response.error) {
      throw new Error(`Source health write failed: ${response.error.message}`);
    }
  }
}
