import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { normalizeAustinTrafficFeed } from "../src/feeds/austin-traffic.js";
import type { ChatModel } from "../src/models/types.js";
import { MemoryAnalysisRepository } from "../src/repositories/memory-analysis-repository.js";
import { DeterministicSecurityScanner } from "../src/security/deterministic-scanner.js";
import { HiddenLayerClient } from "../src/security/hiddenlayer-client.js";
import {
  ToolSecurityBoundary,
  type SecurityStage,
} from "../src/security/types.js";
import { AnalysisProcessor } from "../src/services/analysis-processor.js";
import { NemotronAnalyzer } from "../src/services/nemotron-analyzer.js";

const decision = JSON.stringify({
  affected_entities: [],
  confidence: 0.8,
  evidence: ["Verified traffic feed"],
  incident_type: "traffic_collision",
  memory_effect: {
    adjusted_prediction_minutes: 25,
    base_prediction_minutes: 25,
    similar_incident_count: 0,
    used_historical_memory: false,
  },
  predicted_duration_minutes: 25,
  recommended_actions: ["Monitor traffic conditions"],
  requires_human_approval: false,
  severity: 3,
  summary: "A collision is affecting local traffic.",
  title: "Traffic collision",
});

async function loadTrafficPayload(name: string) {
  const [event] = normalizeAustinTrafficFeed(
    JSON.parse(
      await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
    ) as unknown,
  );
  if (!event) throw new Error(`Fixture ${name} contained no traffic event`);
  return event.payload;
}

class CountingModel implements ChatModel {
  calls = 0;
  readonly modelName = "nemotron-security-test";

  complete(): Promise<string> {
    this.calls += 1;
    return Promise.resolve(decision);
  }
}

describe("HiddenLayer security pipeline", () => {
  it("quarantines a prompt injection before Nemotron is called", async () => {
    const model = new CountingModel();
    const scanner = new DeterministicSecurityScanner();
    const repository = new MemoryAnalysisRepository();
    repository.addJob(
      await loadTrafficPayload("austin-traffic-malicious.json"),
    );
    const processor = new AnalysisProcessor(
      repository,
      new NemotronAnalyzer(model, undefined, scanner),
      "security-worker",
      8,
      4,
      scanner,
    );

    await expect(processor.processBatch()).resolves.toMatchObject({
      completed: 0,
      failed: 0,
      quarantined: 1,
    });
    expect(model.calls).toBe(0);
    expect(repository.persisted).toHaveLength(0);
    expect(repository.quarantined[0]?.finding).toMatchObject({
      blocked: true,
      stage: "feed_input",
    });
  });

  it("scans benign input, prompt, model output, and alert output", async () => {
    const stages: SecurityStage[] = [];
    const baseScanner = new DeterministicSecurityScanner();
    const scanner = {
      scan: async (...argumentsValue: Parameters<typeof baseScanner.scan>) => {
        stages.push(argumentsValue[0]);
        return baseScanner.scan(...argumentsValue);
      },
    };
    const repository = new MemoryAnalysisRepository();
    repository.addJob(await loadTrafficPayload("austin-traffic.json"));
    const processor = new AnalysisProcessor(
      repository,
      new NemotronAnalyzer(new CountingModel(), undefined, scanner),
      "security-worker",
      8,
      4,
      scanner,
    );

    await expect(processor.processBatch()).resolves.toMatchObject({
      completed: 1,
    });
    expect(stages).toEqual([
      "feed_input",
      "model_prompt",
      "model_output",
      "alert_output",
    ]);
  });

  it("uses the official interactions endpoint and normalizes blocking detections", async () => {
    let requestUrl = "";
    const fetcher: typeof fetch = (input) => {
      requestUrl =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            action: "block",
            detections: [
              {
                category: "prompt_injection",
                message: "Instruction override detected",
                severity: "high",
              },
            ],
            event_id: "hl-event-1",
            threat_level: "High",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    };
    const scanner = new HiddenLayerClient(
      {
        apiKey: "test-key",
        baseUrl: "https://api.hiddenlayer.test",
        requesterId: "pulse-test",
      },
      fetcher,
    );

    await expect(
      scanner.scan("feed_input", "malicious content"),
    ).resolves.toMatchObject({
      blocked: true,
      detections: [{ category: "prompt_injection", severity: "high" }],
      eventId: "hl-event-1",
      provider: "hiddenlayer",
    });
    expect(requestUrl).toBe(
      "https://api.hiddenlayer.test/detection/v1/interactions",
    );
  });

  it("exchanges client credentials once and reuses the access token", async () => {
    const requests: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: typeof fetch = (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      const authorization = new Headers(init?.headers).get("Authorization");
      requests.push({ authorization, url });
      if (url.endsWith("/oauth2/token")) {
        expect(init?.body).toBeInstanceOf(URLSearchParams);
        if (!(init?.body instanceof URLSearchParams)) {
          throw new Error("Expected form-encoded HiddenLayer credentials");
        }
        expect(init.body.get("grant_type")).toBe("client_credentials");
        return Promise.resolve(
          Response.json({
            access_token: "short-lived-test-token",
            expires_in: 3_599,
            token_type: "Bearer",
          }),
        );
      }
      return Promise.resolve(
        Response.json({ action: "allow", detections: [] }),
      );
    };
    const scanner = new HiddenLayerClient(
      {
        authUrl: "https://auth.hiddenlayer.test",
        baseUrl: "https://api.hiddenlayer.test",
        clientId: "test-client",
        clientSecret: "test-secret",
        requesterId: "pulse-test",
      },
      fetcher,
    );

    await scanner.scan("model_prompt", "first safe prompt");
    await scanner.scan("model_output", "first safe response");

    expect(requests.map(({ url }) => url)).toEqual([
      "https://auth.hiddenlayer.test/oauth2/token",
      "https://api.hiddenlayer.test/detection/v1/interactions",
      "https://api.hiddenlayer.test/detection/v1/interactions",
    ]);
    expect(requests[1]?.authorization).toBe("Bearer short-lived-test-token");
    expect(requests[2]?.authorization).toBe("Bearer short-lived-test-token");
  });

  it("guards tool arguments and results through the same scanner", async () => {
    const boundary = new ToolSecurityBoundary(
      new DeterministicSecurityScanner(),
    );

    await expect(
      boundary.scanCall("lookup_route", { route: "801" }),
    ).resolves.toMatchObject({
      blocked: false,
      stage: "tool_call",
    });
    await expect(
      boundary.scanResult("lookup_route", { delay: 12 }),
    ).resolves.toMatchObject({
      blocked: false,
      stage: "tool_result",
    });
  });
});
