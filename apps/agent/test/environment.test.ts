import { loadAgentEnvironment } from "@pulse-atx/schemas";
import { describe, expect, it } from "vitest";

describe("mission runtime environment", () => {
  it("loads bounded Incident Commander defaults", () => {
    expect(loadAgentEnvironment({})).toMatchObject({
      MISSION_CLAIM_LIMIT: 4,
      MISSION_CONCURRENCY: 2,
      MISSION_LEASE_SECONDS: 60,
      MISSION_MAX_LIFETIME_MS: 14_400_000,
      MISSION_MAX_TOOL_EXECUTIONS_PER_WAKE: 12,
    });
  });

  it("rejects mission bounds that exceed the enforced limits", () => {
    expect(() =>
      loadAgentEnvironment({
        MISSION_CONCURRENCY: "5",
        MISSION_MAX_TOOL_EXECUTIONS_PER_WAKE: "13",
      }),
    ).toThrow("Invalid agent environment");
  });

  it("accepts HiddenLayer client credentials for live mode", () => {
    expect(() =>
      loadAgentEnvironment({
        DEMO_MODE: "false",
        EMBEDDING_BASE_URL: "https://embeddings.example.com/v1",
        EMBEDDING_MODEL: "test-embedding",
        HIDDENLAYER_BASE_URL: "https://api.hiddenlayer.ai",
        HIDDENLAYER_CLIENT_ID: "test-client-id",
        HIDDENLAYER_CLIENT_SECRET: "test-client-secret",
        NEMOTRON_MODEL: "nemotron-test",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
        SUPABASE_URL: "https://test.supabase.co",
        VLLM_BASE_URL: "https://vllm.example.com/v1",
      }),
    ).not.toThrow();
  });
});
