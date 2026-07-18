import "dotenv/config";

import { loadAgentEnvironment } from "@pulse-atx/schemas";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

import { AustinTrafficFeedAdapter } from "./feeds/austin-traffic.js";
import { SupabaseEventRepository } from "./repositories/event-repository.js";
import { MemoryRuntimeRepository } from "./repositories/memory-runtime-repository.js";
import { SupabaseRuntimeRepository } from "./repositories/runtime-repository.js";
import { IngestionService } from "./services/ingestion-service.js";
import { HeartbeatWorker } from "./worker/heartbeat-worker.js";
import {
  SourceScheduler,
  type ScheduledSource,
} from "./worker/source-scheduler.js";

const environment = loadAgentEnvironment(process.env);
const logger = pino({ level: environment.LOG_LEVEL });
const controller = new AbortController();
const once = process.argv.includes("--once");

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the live worker`);
  return value;
}

const stop = (signal: string) => {
  logger.info({ signal }, "graceful shutdown requested");
  controller.abort(new Error(signal));
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const scheduledSources: ScheduledSource[] = [];
let runtimeRepository;
if (environment.DEMO_MODE) {
  runtimeRepository = new MemoryRuntimeRepository();
} else {
  const client = createClient(
    requireValue(environment.SUPABASE_URL, "SUPABASE_URL"),
    requireValue(
      environment.SUPABASE_SERVICE_ROLE_KEY,
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  runtimeRepository = new SupabaseRuntimeRepository(client);
  if (environment.AUSTIN_TRAFFIC_FEED_URL) {
    const ingestion = new IngestionService(
      new AustinTrafficFeedAdapter(environment.AUSTIN_TRAFFIC_FEED_URL),
      new SupabaseEventRepository(client),
    );
    scheduledSources.push({
      id: "austin_traffic",
      intervalMs: environment.TRAFFIC_POLL_INTERVAL_MS,
      poll: (signal) => ingestion.poll(signal),
    });
  }
}

const worker = new HeartbeatWorker(
  runtimeRepository,
  new SourceScheduler(scheduledSources),
  {
    heartbeatIntervalMs: environment.HEARTBEAT_INTERVAL_MS,
    staleJobAfterMs: environment.STALE_JOB_AFTER_MS,
    workerId: environment.WORKER_ID,
  },
  () => new Date(),
  (summary) => logger.info(summary, "heartbeat completed"),
);

logger.info(
  { demoMode: environment.DEMO_MODE, workerId: environment.WORKER_ID },
  "agent worker booting",
);
await worker.run(once, controller.signal);
