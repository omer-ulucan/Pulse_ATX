import { readFile } from "node:fs/promises";

import {
  isOpenShellDestinationAllowed,
  openShellFilesystemAccess,
  parseOpenShellPolicy,
} from "@pulse-atx/shared";
import { describe, expect, it } from "vitest";

async function loadPolicy() {
  return parseOpenShellPolicy(
    await readFile(
      new URL("../../../policies/openshell.yaml", import.meta.url),
      "utf8",
    ),
  );
}

describe("OpenShell runtime policy", () => {
  it("allows only the approved method and feed path", async () => {
    const policy = await loadPolicy();
    expect(
      isOpenShellDestinationAllowed(policy, {
        binaryPath: "/usr/bin/node",
        method: "GET",
        url: "https://api.weather.gov/alerts/active?area=TX",
      }),
    ).toBe(true);
    expect(
      isOpenShellDestinationAllowed(policy, {
        binaryPath: "/usr/bin/node",
        method: "POST",
        url: "https://api.weather.gov/alerts/active?area=TX",
      }),
    ).toBe(false);
  });

  it("blocks an unapproved exfiltration destination", async () => {
    const policy = await loadPolicy();
    expect(
      isOpenShellDestinationAllowed(policy, {
        binaryPath: "/usr/bin/node",
        method: "POST",
        url: "https://example.com/collect/pulse-atx",
      }),
    ).toBe(false);
  });

  it("restricts writes to workspace and state paths", async () => {
    const policy = await loadPolicy();
    expect(
      openShellFilesystemAccess(policy, "/sandbox/workspace/data.json"),
    ).toBe("read-write");
    expect(openShellFilesystemAccess(policy, "/etc/passwd")).toBe("read-only");
    expect(
      openShellFilesystemAccess(policy, "/sandbox/.openclaw/config.json"),
    ).toBe("inaccessible");
    expect(policy.landlock?.compatibility).toBe("hard_requirement");
    expect(policy.process).toEqual({
      run_as_group: "sandbox",
      run_as_user: "sandbox",
    });
  });

  it("provides a NemoClaw custom preset without broad wildcard egress", async () => {
    const preset = await readFile(
      new URL("../../../policies/nemoclaw-pulse-atx.yaml", import.meta.url),
      "utf8",
    );
    expect(preset).toContain("name: pulse-atx");
    expect(preset).toContain("api.hiddenlayer.ai");
    expect(preset).not.toMatch(/host:\s+["']?\*["']?\s*$/m);
  });
});
