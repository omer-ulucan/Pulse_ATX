import "dotenv/config";

import { loadAgentEnvironment } from "@pulse-atx/schemas";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

import { DemoControlServer } from "./control/control-server.js";
import { MissionExecutionEngine } from "./commander/mission-engine.js";
import { MissionLifecycleCoordinator } from "./commander/mission-lifecycle.js";
import { MissionPlanner } from "./commander/mission-planner.js";
import {
  SecureMissionToolRunner,
  OpenShellToolPolicy,
} from "./commander/secure-tool-runner.js";
import { SupabaseCommanderOperations } from "./commander/supabase-commander-operations.js";
import { SupabaseMissionRepository } from "./commander/supabase-mission-repository.js";
import { createDefaultToolRegistry } from "./commander/tools/default-tools.js";
import { SupabaseDemoControlRepository } from "./control/demo-control-repository.js";
import { CrossFeedCorrelationService } from "./correlation/cross-feed-correlator.js";
import { CapMetroAlertsFeedAdapter } from "./feeds/capmetro-alerts.js";
import { NoaaAlertsFeedAdapter } from "./feeds/noaa-alerts.js";
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
import { ToolSecurityBoundary } from "./security/types.js";
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
let controlServer: DemoControlServer | undefined;
let missionProcessor: MissionLifecycleCoordinator | undefined;
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
  if (environment.CONTROL_SERVER_ENABLED) {
    controlServer = new DemoControlServer(
      new SupabaseDemoControlRepository(client),
      {
        allowedOrigin: environment.CONTROL_ALLOWED_ORIGIN,
        host: environment.CONTROL_SERVER_HOST,
        port: environment.CONTROL_SERVER_PORT,
        secret: requireValue(environment.DEMO_SECRET, "DEMO_SECRET"),
      },
      (message, context) => logger.info(context ?? {}, message),
    );
  }
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
  const learningRepository = new SupabaseLearningRepository(client);
  memoryService = new MemoryService(
    new EmbeddingClient({
      apiKey: environment.EMBEDDING_API_KEY,
      baseUrl: requireValue(
        environment.EMBEDDING_BASE_URL,
        "EMBEDDING_BASE_URL",
      ),
      modelName: requireValue(environment.EMBEDDING_MODEL, "EMBEDDING_MODEL"),
    }),
    learningRepository,
    new LessonExtractor(vllm, security),
  );
  const analysisRepository = new SupabaseAnalysisRepository(client);
  jobProcessor = new AnalysisProcessor(
    analysisRepository,
    new NemotronAnalyzer(vllm, vllm.metrics, security),
    environment.WORKER_ID,
    8,
    4,
    security,
    memoryService,
    new CrossFeedCorrelationService(analysisRepository),
  );
  const missionRepository = new SupabaseMissionRepository(client);
  const missionOperations = new SupabaseCommanderOperations(
    client,
    learningRepository,
    memoryService,
  );
  const toolRegistry = createDefaultToolRegistry();
  const missionPlanner = new MissionPlanner(vllm, toolRegistry, security);
  const missionToolRunner = new SecureMissionToolRunner(
    toolRegistry,
    missionRepository,
    new ToolSecurityBoundary(security),
    new OpenShellToolPolicy(),
    missionOperations,
    { logger: (message, context) => logger.info(context, message) },
  );
  const missionEngine = new MissionExecutionEngine(
    missionRepository,
    missionPlanner,
    toolRegistry,
    missionOperations,
    missionToolRunner,
    {
      maxMissionLifetimeMs: environment.MISSION_MAX_LIFETIME_MS,
      maxToolExecutionsPerWake:
        environment.MISSION_MAX_TOOL_EXECUTIONS_PER_WAKE,
    },
  );
  missionProcessor = new MissionLifecycleCoordinator(
    missionRepository,
    missionPlanner,
    missionEngine,
    missionOperations,
    {
      claimLimit: environment.MISSION_CLAIM_LIMIT,
      concurrency: environment.MISSION_CONCURRENCY,
      leaseSeconds: environment.MISSION_LEASE_SECONDS,
      workerId: environment.WORKER_ID,
    },
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
  if (environment.CAPMETRO_FEED_URL) {
    const ingestion = new IngestionService(
      new CapMetroAlertsFeedAdapter(environment.CAPMETRO_FEED_URL),
      new SupabaseEventRepository(client),
    );
    scheduledSources.push({
      id: "capmetro",
      intervalMs: environment.TRANSIT_POLL_INTERVAL_MS,
      poll: (signal) => ingestion.poll(signal),
    });
  }
  if (environment.NOAA_ALERTS_URL) {
    const ingestion = new IngestionService(
      new NoaaAlertsFeedAdapter(environment.NOAA_ALERTS_URL),
      new SupabaseEventRepository(client),
    );
    scheduledSources.push({
      id: "noaa_weather",
      intervalMs: environment.WEATHER_POLL_INTERVAL_MS,
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
  missionProcessor,
);

logger.info(
  { demoMode: environment.DEMO_MODE, workerId: environment.WORKER_ID },
  "agent worker booting",
);
if (controlServer) {
  const address = await controlServer.start();
  logger.info({ address }, "protected control server listening");
}
try {
  await worker.run(once, controller.signal);
} finally {
  await controlServer?.stop();
}
