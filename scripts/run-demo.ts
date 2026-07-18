import "dotenv/config";

import { z } from "zod";

const EnvironmentSchema = z.object({
  DEMO_OPERATOR: z
    .string()
    .trim()
    .min(2)
    .default("Austin Emergency Operations Center"),
  DEMO_SECRET: z.string().min(32),
  NEXT_PUBLIC_AGENT_CONTROL_URL: z.url(),
});

const DemoResultSchema = z.object({
  alert_id: z.uuid().nullable(),
  incident_id: z.uuid().nullable(),
  raw_event_id: z.uuid().nullable(),
  scenario: z.enum([
    "benign",
    "cross_feed",
    "recursive_memory",
    "prompt_injection",
    "exfiltration",
    "critical_approval",
  ]),
  security_finding_id: z.uuid().nullable(),
});

const environment = EnvironmentSchema.parse(process.env);
const controlUrl = environment.NEXT_PUBLIC_AGENT_CONTROL_URL.replace(/\/$/, "");
const scenarios = DemoResultSchema.shape.scenario.options;

async function post(
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const request: RequestInit = {
    headers: {
      Authorization: `Bearer ${environment.DEMO_SECRET}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  };
  if (body) request.body = JSON.stringify(body);
  const response = await fetch(`${controlUrl}${path}`, request);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(
      message.success
        ? message.data.error
        : `Control server returned HTTP ${response.status}`,
    );
  }
  return payload;
}

const results = [];
for (const scenario of scenarios) {
  const result = DemoResultSchema.parse(await post(`/v1/demo/${scenario}`));
  results.push(result);
  process.stdout.write(`Created ${scenario} scenario.\n`);
}

const criticalAlert = results.find(
  (result) => result.scenario === "critical_approval",
)?.alert_id;
if (!criticalAlert)
  throw new Error("Critical scenario did not create an alert");

await post(`/v1/alerts/${criticalAlert}/approve`, {
  operator: environment.DEMO_OPERATOR,
});
process.stdout.write(
  `Approved critical alert ${criticalAlert} as ${environment.DEMO_OPERATOR}.\n`,
);
