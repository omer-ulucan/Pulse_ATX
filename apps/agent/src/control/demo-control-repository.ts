import { DemoScenarioSchema, type DemoScenario } from "@pulse-atx/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const DemoResultSchema = z.object({
  alert_id: z.uuid().nullable(),
  incident_id: z.uuid().nullable(),
  raw_event_id: z.uuid().nullable(),
  scenario: DemoScenarioSchema,
  security_finding_id: z.uuid().nullable(),
});

export type DemoResult = z.infer<typeof DemoResultSchema>;

export interface DemoControlRepository {
  approveAlert(alertId: string, operator: string): Promise<string>;
  runScenario(scenario: DemoScenario, nonce: string): Promise<DemoResult>;
}

export class SupabaseDemoControlRepository implements DemoControlRepository {
  constructor(private readonly client: SupabaseClient) {}

  async approveAlert(alertId: string, operator: string): Promise<string> {
    const response = (await this.client.rpc("approve_alert", {
      p_alert_id: alertId,
      p_operator: operator,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Alert approval failed: ${response.error.message}`);
    return z.uuid().parse(response.data);
  }

  async runScenario(
    scenario: DemoScenario,
    nonce: string,
  ): Promise<DemoResult> {
    const response = (await this.client.rpc("run_demo_scenario", {
      p_nonce: nonce,
      p_scenario: scenario,
    })) as { data: unknown; error: { message: string } | null };
    if (response.error)
      throw new Error(`Demo scenario failed: ${response.error.message}`);
    return DemoResultSchema.parse(response.data);
  }
}
