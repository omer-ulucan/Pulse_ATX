import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { DemoControlServer } from "../src/control/control-server.js";
import { MemoryDemoControlRepository } from "../src/control/memory-demo-control-repository.js";

const runningServers: DemoControlServer[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.stop()));
});

async function startServer() {
  const repository = new MemoryDemoControlRepository();
  const server = new DemoControlServer(repository, {
    allowedOrigin: "http://localhost:3000",
    host: "127.0.0.1",
    port: 0,
    secret: "test-control-secret-with-sufficient-entropy",
  });
  runningServers.push(server);
  return { address: await server.start(), repository };
}

describe("protected agent controls", () => {
  it("exposes health without exposing controls", async () => {
    const { address } = await startServer();
    await expect(
      fetch(`${address}/health`).then((response) => response.json()),
    ).resolves.toEqual({
      status: "ok",
    });
    const response = await fetch(`${address}/v1/demo/benign`, {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });

  it("rejects a browser origin outside the allowlist", async () => {
    const { address } = await startServer();
    const response = await fetch(`${address}/v1/demo/benign`, {
      headers: {
        Authorization: "Bearer test-control-secret-with-sufficient-entropy",
        Origin: "https://untrusted.example",
      },
      method: "POST",
    });
    expect(response.status).toBe(403);
  });

  it("runs every deterministic scenario through the authenticated endpoint", async () => {
    const { address, repository } = await startServer();
    for (const scenario of [
      "benign",
      "cross_feed",
      "recursive_memory",
      "prompt_injection",
      "exfiltration",
      "critical_approval",
    ]) {
      const response = await fetch(`${address}/v1/demo/${scenario}`, {
        headers: {
          Authorization: "Bearer test-control-secret-with-sufficient-entropy",
          Origin: "http://localhost:3000",
        },
        method: "POST",
      });
      expect(response.status).toBe(201);
    }
    expect(repository.scenarios.map((item) => item.scenario)).toEqual([
      "benign",
      "cross_feed",
      "recursive_memory",
      "prompt_injection",
      "exfiltration",
      "critical_approval",
    ]);
  });

  it("approves a pending alert with operator identity", async () => {
    const { address, repository } = await startServer();
    const alertId = randomUUID();
    const response = await fetch(`${address}/v1/alerts/${alertId}/approve`, {
      body: JSON.stringify({ operator: "Austin EOC operator" }),
      headers: {
        Authorization: "Bearer test-control-secret-with-sufficient-entropy",
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(repository.approvals).toEqual([
      { alertId, operator: "Austin EOC operator" },
    ]);
  });

  it("returns bounded client errors for malformed approval requests", async () => {
    const { address } = await startServer();
    const alertId = randomUUID();
    const malformed = await fetch(`${address}/v1/alerts/${alertId}/approve`, {
      body: "{",
      headers: {
        Authorization: "Bearer test-control-secret-with-sufficient-entropy",
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      method: "POST",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${address}/v1/alerts/${alertId}/approve`, {
      body: JSON.stringify({ operator: "x".repeat(17_000) }),
      headers: {
        Authorization: "Bearer test-control-secret-with-sufficient-entropy",
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
  });
});
