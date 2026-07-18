import "dotenv/config";

import { loadAgentEnvironment } from "@pulse-atx/schemas";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

import { AustinTrafficFeedAdapter } from "./feeds/austin-traffic.js";
import { EmbeddingClient } from "./memory/embedding-client.js";
import { SupabaseLearningRepository } from "./memory/learning-repository.js";
import { LessonExtractor } from "./memory/lesson-extractor.js";
import { MemoryService } from "./memory/memory-service.js";
import { VllmClient } from "./models/vllm-client.js";
import { SupabaseAnalysisRepository } from "./repositories/analysis-repository.js";
import { SupabaseEventRepository } from "./repositories/event-repository.js";
import { MemoryRuntimeRepository } from "./repositories/memory-runtime-repository.js";
import { SupabaseRuntimeRepository } from "./repositories/runtime-repository.js";
import { HiddenLayerClient } from "./security/hiddenlayer-client.js";
import { IngestionService } from "./services/ingestion-service.js";
import { AnalysisProcessor } from "./services/analysis-processor.js";
import { NemotronAnalyzer } from "./services/nemotron-analyzer.js";
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
let jobProcessor: AnalysisProcessor | undefined;
let memoryService: MemoryService | undefined;
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
  const vllm = new VllmClient({
    apiKey: environment.VLLM_API_KEY,
    baseUrl: requireValue(environment.VLLM_BASE_URL, "VLLM_BASE_URL"),
    modelName: requireValue(environment.NEMOTRON_MODEL, "NEMOTRON_MODEL"),
  });
  const security = new HiddenLayerClient({
    apiKey: requireValue(
      environment.HIDDENLAYER_API_KEY,
      "HIDDENLAYER_API_KEY",
    ),
    baseUrl: requireValue(
      environment.HIDDENLAYER_BASE_URL,
      "HIDDENLAYER_BASE_URL",
    ),
    requesterId: environment.WORKER_ID,
  });
  memoryService = new MemoryService(
    new EmbeddingClient({
      apiKey: environment.EMBEDDING_API_KEY,
      baseUrl: requireValue(
        environment.EMBEDDING_BASE_URL,
        "EMBEDDING_BASE_URL",
      ),
      modelName: requireValue(environment.EMBEDDING_MODEL, "EMBEDDING_MODEL"),
    }),
    new SupabaseLearningRepository(client),
    new LessonExtractor(vllm, security),
  );
  jobProcessor = new AnalysisProcessor(
    new SupabaseAnalysisRepository(client),
    new NemotronAnalyzer(vllm, vllm.metrics, security),
    environment.WORKER_ID,
    8,
    4,
    security,
    memoryService,
  );
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
  jobProcessor,
  memoryService,
);

logger.info(
  { demoMode: environment.DEMO_MODE, workerId: environment.WORKER_ID },
  "agent worker booting",
);
await worker.run(once, controller.signal);
