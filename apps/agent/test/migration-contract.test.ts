import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("core schema migration", () => {
  it("defines idempotent event and job constraints", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180001_core_schema.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("unique (source, external_id)");
    expect(migration).toContain(
      "unique (raw_event_id, raw_event_revision, job_type)",
    );
    expect(migration).toContain(
      "create or replace function public.ingest_raw_event",
    );
    expect(migration).toContain("existing_event.fingerprint = p_fingerprint");
  });

  it("defines stale processing recovery", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180002_heartbeat_queue.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("recover_stale_event_jobs");
    expect(migration).toContain("status = 'processing'");
    expect(migration).toContain(
      "status = case when attempts >= p_max_attempts",
    );
  });
});
