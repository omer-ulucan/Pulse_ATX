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

  it("stores OpenShell policy violations for realtime visibility", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180007_runtime_containment.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("record_runtime_policy_violation");
    expect(migration).toContain("'runtime_policy'");
    expect(migration).toContain("'openshell'");
    expect(migration).toContain("'blocked'");
  });

  it("creates threshold alerts and protects operator approval", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180008_alerts_approval_demo.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("generate_alert_from_decision");
    expect(migration).toContain("decision_severity >= 3");
    expect(migration).toContain("decision_confidence >= 0.65");
    expect(migration).toContain("'pending_approval'");
    expect(migration).toContain("approve_alert");
    expect(migration).toContain("run_demo_scenario");
  });

  it("defines idempotent complete demo scenarios", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180009_final_demo_hardening.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("unique (scenario, nonce)");
    expect(migration).toContain("'cross_feed'");
    expect(migration).toContain("'recursive_memory'");
    expect(migration).toContain("public.store_incident_memory");
    expect(migration).toContain("'cross_feed_correlation'");
  });

  it("uses the named job constraint to avoid PL/pgSQL output ambiguity", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607180010_ingestion_ambiguity_fix.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      "on conflict on constraint event_jobs_raw_event_id_raw_event_revision_job_type_key",
    );
    expect(migration).toContain("where jobs.raw_event_id = stored_event.id");
  });

  it("defines persistent autonomous incident commander state", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607190001_agent_missions.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("create table public.agent_missions");
    expect(migration).toContain("create table public.agent_mission_steps");
    expect(migration).toContain("create table public.agent_observations");
    expect(migration).toContain("create table public.agent_tool_executions");
    expect(migration).toContain("agent_missions_active_incident_unique_idx");
    expect(migration).toContain("unique(mission_id, state_fingerprint)");
    expect(migration).toContain(
      "unique(mission_id, tool_name, arguments_fingerprint)",
    );
    expect(migration).toContain("lease_expires_at timestamptz");
    expect(migration).toContain(
      "alter publication supabase_realtime add table",
    );
  });

  it("defines atomic mission claims, execution idempotency, and approval", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607190002_agent_mission_runtime.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("create_agent_mission");
    expect(migration).toContain("claim_agent_missions");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("persist_agent_mission_plan");
    expect(migration).toContain("p_plan_version not between 1 and 4");
    expect(migration).toContain("begin_agent_tool_execution");
    expect(migration).toContain(
      "on conflict (mission_id, tool_name, arguments_fingerprint)",
    );
    expect(migration).toContain("decide_agent_tool_approval");
    expect(migration).toContain("approval_status in ('approved', 'rejected')");
  });

  it("defines the staged Incident Commander replay and meaningful-update wake", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/202607190003_incident_commander_demo.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("plan_version between 1 and 4");
    expect(migration).toContain("advance_waiting_mission_on_incident_update");
    expect(migration).toContain("run_incident_commander_demo_stage");
    expect(migration).toContain("timeline.metadata->>'nonce' = p_nonce::text");
    expect(migration).toContain(
      "p_stage not in ('initial', 'escalation', 'recovery', 'final')",
    );
    expect(migration).toContain("'austin_traffic'");
    expect(migration).toContain("'capmetro'");
    expect(migration).toContain("'noaa_weather'");
    expect(migration).toContain("'transit_delay_minutes', 14");
    expect(migration).toContain("predicted_duration_minutes = 43");
    expect(migration).toContain("'actual_duration_minutes', 40");
    expect(migration).toContain("to service_role");
  });
});
