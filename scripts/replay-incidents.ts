import "dotenv/config";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environment = z
  .object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
  })
  .parse(process.env);
const ReplaySchema = z.array(
  z.object({
    event: z.record(z.string(), z.unknown()),
  }),
);
const fixture: unknown = JSON.parse(
  await readFile(
    new URL("./fixtures/historical-incidents.json", import.meta.url),
    "utf8",
  ),
);
const records = ReplaySchema.parse(fixture);
const client = createClient(
  environment.SUPABASE_URL,
  environment.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

for (const { event } of records) {
  const externalId = z.string().parse(event.traffic_report_id);
  const predictionSafeEvent = { ...event };
  delete predictionSafeEvent.actual_duration_minutes;
  delete predictionSafeEvent.outcome;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(predictionSafeEvent))
    .digest("hex");
  const response = (await client.rpc("ingest_raw_event", {
    p_event_type: "traffic_incident",
    p_external_id: externalId,
    p_fingerprint: fingerprint,
    p_payload: predictionSafeEvent,
    p_source: "demo",
  })) as { error: { message: string } | null };
  if (response.error) throw new Error(response.error.message);
}

process.stdout.write(`Replayed ${records.length} prediction-safe incidents.\n`);
