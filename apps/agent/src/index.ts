import { loadAgentEnvironment } from "@pulse-atx/schemas";
import { APP_NAME, sleep } from "@pulse-atx/shared";
import pino from "pino";

const environment = loadAgentEnvironment(process.env);
const logger = pino({ level: environment.LOG_LEVEL });
const once = process.argv.includes("--once");
let stopping = false;

const stop = (signal: string) => {
  stopping = true;
  logger.info({ signal }, "graceful shutdown requested");
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

logger.info(
  {
    app: APP_NAME,
    demoMode: environment.DEMO_MODE,
    workerId: environment.WORKER_ID,
  },
  "agent worker started",
);

do {
  logger.info({ workerId: environment.WORKER_ID }, "heartbeat");
  if (!once && !stopping) {
    await sleep(10_000);
  }
} while (!once && !stopping);

logger.info("agent worker stopped");
