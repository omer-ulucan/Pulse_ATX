import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { DemoScenarioSchema } from "@pulse-atx/schemas";
import { z } from "zod";

import type { DemoControlRepository } from "./demo-control-repository.js";

const ApprovalBodySchema = z.object({
  operator: z.string().trim().min(2).max(120),
});

class ControlRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ControlServerOptions {
  allowedOrigin?: string | undefined;
  host: string;
  port: number;
  secret: string;
}

export type ControlServerLogger = (
  message: string,
  context?: Record<string, unknown>,
) => void;

function authorized(request: IncomingMessage, secret: string): boolean {
  const supplied = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384)
      throw new ControlRequestError(413, "Request body exceeds 16 KiB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ControlRequestError(400, "Request body must be valid JSON");
  }
}

export class DemoControlServer {
  private server: Server | null = null;

  constructor(
    private readonly repository: DemoControlRepository,
    private readonly options: ControlServerOptions,
    private readonly logger: ControlServerLogger = () => undefined,
  ) {}

  start(): Promise<string> {
    if (this.server) throw new Error("Control server is already running");
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        const validationError = error instanceof z.ZodError;
        const status =
          error instanceof ControlRequestError
            ? error.status
            : validationError
              ? 400
              : 500;
        this.logger("control request failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          status,
        });
        if (!response.headersSent && !response.writableEnded) {
          response.writeHead(status, { "Content-Type": "application/json" });
        }
        if (!response.writableEnded) {
          response.end(
            JSON.stringify({
              error:
                status === 500
                  ? "Control request failed"
                  : error instanceof Error
                    ? error.message
                    : "Invalid request",
            }),
          );
        }
      });
    });
    server.headersTimeout = 5_000;
    server.keepAliveTimeout = 5_000;
    server.requestTimeout = 10_000;
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Control server has no TCP address"));
          return;
        }
        resolve(`http://${this.options.host}:${address.port}`);
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private setCors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    if (
      origin &&
      this.options.allowedOrigin &&
      origin !== this.options.allowedOrigin
    ) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Origin is not allowed" }));
      return false;
    }
    if (this.options.allowedOrigin) {
      response.setHeader(
        "Access-Control-Allow-Origin",
        this.options.allowedOrigin,
      );
      response.setHeader("Vary", "Origin");
    }
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
    return true;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.setCors(request, response)) return;
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://control.local");
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (!authorized(request, this.options.secret)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const scenarioMatch = /^\/v1\/demo\/([^/]+)$/.exec(url.pathname);
    if (request.method === "POST" && scenarioMatch) {
      const scenario = DemoScenarioSchema.safeParse(scenarioMatch[1]);
      if (!scenario.success) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Unsupported demo scenario" }));
        return;
      }
      const result = await this.repository.runScenario(
        scenario.data,
        randomUUID(),
      );
      this.logger("demo scenario created", { scenario: scenario.data });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }

    const approvalMatch = /^\/v1\/alerts\/([^/]+)\/approve$/.exec(url.pathname);
    if (request.method === "POST" && approvalMatch) {
      const alertId = z.uuid().parse(approvalMatch[1]);
      const body = ApprovalBodySchema.parse(await readJsonBody(request));
      await this.repository.approveAlert(alertId, body.operator);
      this.logger("alert approved", { alertId, operator: body.operator });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ alertId, status: "approved" }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  }
}
