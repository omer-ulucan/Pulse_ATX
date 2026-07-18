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

  it("claims jobs with skip locked and atomically persists analysis", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180003_analysis_pipeline.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("persist_analysis_result");
    expect(migration).toContain("insert into public.agent_decisions");
    expect(migration).toContain("set status = 'completed'");
  });

  it("atomically quarantines blocked security events", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180004_hiddenlayer_security.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("insert into public.security_findings");
    expect(migration).toContain("security_status = 'quarantined'");
    expect(migration).toContain("status = 'quarantined'");
  });

  it("combines vector search with deterministic memory filters", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180005_recursive_memory.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("extensions.vector(384)");
    expect(migration).toContain("memories.embedding <=> p_query_embedding");
    expect(migration).toContain("incidents.incident_type = p_incident_type");
    expect(migration).toContain("record_incident_outcome");
    expect(migration).toContain("list_memory_candidates");
  });

  it("defines atomic cross-feed correlation RPCs", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180006_cross_feed_intelligence.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("list_cross_feed_candidates");
    expect(migration).toContain("apply_cross_feed_correlation");
    expect(migration).toContain("'correlated'");
    expect(migration).toContain("greatest(coalesce(severity, 1)");
  });
});
