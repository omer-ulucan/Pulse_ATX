import "dotenv/config";

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  isOpenShellDestinationAllowed,
  parseOpenShellPolicy,
} from "@pulse-atx/shared";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NEMOCLAW_SANDBOX_NAME: z.string().min(1).default("pulse-atx"),
  OPENSHELL_LIVE_CONTAINMENT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
});

const approvedUrl = "https://api.weather.gov/alerts/active?area=TX";
const forbiddenUrl = "https://example.com/collect/pulse-atx";
const nodeBinary = "/usr/bin/node";

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

function runSandboxRequest(
  sandbox: string,
  url: string,
): Promise<CommandResult> {
  const program = [
    "fetch(process.argv[1])",
    ".then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); console.log(response.status); })",
    ".catch((error) => { console.error(error.message); process.exit(2); });",
  ].join("");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "nemoclaw",
      [sandbox, "exec", "--", "node", "-e", program, url],
      { shell: false, windowsHide: true },
    );
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      }),
    );
  });
}

const environment = EnvironmentSchema.parse(process.env);
const policy = parseOpenShellPolicy(
  await readFile(
    new URL("../policies/openshell.yaml", import.meta.url),
    "utf8",
  ),
);
const approvedByPolicy = isOpenShellDestinationAllowed(policy, {
  binaryPath: nodeBinary,
  method: "GET",
  url: approvedUrl,
});
const forbiddenByPolicy = isOpenShellDestinationAllowed(policy, {
  binaryPath: nodeBinary,
  method: "POST",
  url: forbiddenUrl,
});
if (!approvedByPolicy || forbiddenByPolicy) {
  throw new Error(
    "Checked-in OpenShell policy does not enforce the expected boundary",
  );
}

let enforcement = "validated-policy";
let evidence = "Destination absent from the deny-by-default network policy";
if (environment.OPENSHELL_LIVE_CONTAINMENT) {
  const approved = await runSandboxRequest(
    environment.NEMOCLAW_SANDBOX_NAME,
    approvedUrl,
  );
  if (approved.code !== 0)
    throw new Error(
      `Approved request failed: ${approved.stderr || approved.stdout}`,
    );
  const forbidden = await runSandboxRequest(
    environment.NEMOCLAW_SANDBOX_NAME,
    forbiddenUrl,
  );
  if (forbidden.code === 0)
    throw new Error("OpenShell unexpectedly allowed the forbidden destination");
  enforcement = "openshell-live";
  evidence = forbidden.stderr || forbidden.stdout || "OpenShell denied CONNECT";
}

let findingId: string | null = null;
if (environment.SUPABASE_URL && environment.SUPABASE_SERVICE_ROLE_KEY) {
  const client = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const response = (await client.rpc("record_runtime_policy_violation", {
    p_binary: nodeBinary,
    p_destination: forbiddenUrl,
    p_details: { enforcement, evidence },
    p_reason: "Destination is not present in the OpenShell allowlist",
  })) as { data: unknown; error: { message: string } | null };
  if (response.error)
    throw new Error(
      `Runtime violation persistence failed: ${response.error.message}`,
    );
  findingId = z.uuid().parse(response.data);
}

console.log(
  JSON.stringify(
    {
      approved: { allowed: true, url: approvedUrl },
      enforcement,
      forbidden: { allowed: false, url: forbiddenUrl },
      securityFindingId: findingId,
    },
    null,
    2,
  ),
);
