import { randomUUID } from "node:crypto";

import type { DemoScenario } from "@pulse-atx/schemas";

import type {
  DemoControlRepository,
  DemoResult,
} from "./demo-control-repository.js";

export class MemoryDemoControlRepository implements DemoControlRepository {
  readonly approvals: { alertId: string; operator: string }[] = [];
  readonly scenarios: { nonce: string; scenario: DemoScenario }[] = [];

  approveAlert(alertId: string, operator: string): Promise<string> {
    this.approvals.push({ alertId, operator });
    return Promise.resolve(alertId);
  }

  runScenario(scenario: DemoScenario, nonce: string): Promise<DemoResult> {
    this.scenarios.push({ nonce, scenario });
    return Promise.resolve({
      alert_id: scenario === "critical_approval" ? randomUUID() : null,
      incident_id: scenario === "critical_approval" ? randomUUID() : null,
      raw_event_id:
        scenario === "benign" || scenario === "prompt_injection"
          ? randomUUID()
          : null,
      scenario,
      security_finding_id: scenario === "exfiltration" ? randomUUID() : null,
    });
  }
}
