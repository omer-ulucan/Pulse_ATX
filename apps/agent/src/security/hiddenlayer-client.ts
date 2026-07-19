import { z } from "zod";

import type {
  SecurityDetection,
  SecurityScanner,
  SecurityScanResult,
  SecuritySeverity,
  SecurityStage,
} from "./types.js";

const DetectionSchema = z
  .object({
    action: z.string().optional(),
    category: z.string().optional(),
    message: z.string().optional(),
    severity: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const HiddenLayerResponseSchema = z
  .object({
    action: z.string().optional(),
    analysis: z
      .array(
        z
          .object({
            detected: z.boolean(),
            name: z.string(),
            phase: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
    detections: z.array(DetectionSchema).default([]),
    evaluation: z
      .object({
        action: z.string(),
        has_detections: z.boolean(),
        threat_level: z.string(),
      })
      .optional(),
    event_id: z.string().optional(),
    interaction_id: z.string().optional(),
    metadata: z
      .object({ event_id: z.string().nullable().optional() })
      .passthrough()
      .optional(),
    threat_level: z.string().optional(),
  })
  .passthrough();

const HiddenLayerTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().default(3_600),
  token_type: z.string().default("Bearer"),
});

export interface HiddenLayerClientOptions {
  apiKey?: string;
  authUrl?: string;
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  requesterId: string;
  timeoutMs?: number;
}

function normalizeSeverity(value: string | undefined): SecuritySeverity {
  const normalized = value?.toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "med" || normalized === "medium") return "medium";
  return "low";
}

function isOutputStage(stage: SecurityStage): boolean {
  return (
    stage === "alert_output" ||
    stage === "model_output" ||
    stage === "tool_result"
  );
}

export class HiddenLayerClient implements SecurityScanner {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private accessToken: { expiresAt: number; value: string } | undefined;

  constructor(
    private readonly options: HiddenLayerClientOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!options.apiKey && (!options.clientId || !options.clientSecret)) {
      throw new Error(
        "HiddenLayer requires HIDDENLAYER_CLIENT_ID and HIDDENLAYER_CLIENT_SECRET",
      );
    }
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/detection/v1/interactions`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async authorizationHeader(signal?: AbortSignal): Promise<string> {
    if (this.options.apiKey) return `Bearer ${this.options.apiKey}`;
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return `Bearer ${this.accessToken.value}`;
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetcher(
      `${(this.options.authUrl ?? "https://auth.hiddenlayer.ai").replace(/\/$/, "")}/oauth2/token`,
      {
        body: new URLSearchParams({
          client_id: this.options.clientId!,
          client_secret: this.options.clientSecret!,
          grant_type: "client_credentials",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: requestSignal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `HiddenLayer authentication returned HTTP ${response.status}`,
      );
    }
    const token = HiddenLayerTokenSchema.parse(await response.json());
    this.accessToken = {
      expiresAt: Date.now() + token.expires_in * 1_000,
      value: token.access_token,
    };
    return `${token.token_type} ${token.access_token}`;
  }

  async scan(
    stage: SecurityStage,
    content: string,
    metadata: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<SecurityScanResult> {
    const authorization = await this.authorizationHeader(signal);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const outputStage = isOutputStage(stage);
    const response = await this.fetcher(this.endpoint, {
      body: JSON.stringify({
        metadata: {
          model:
            typeof metadata.model === "string"
              ? metadata.model
              : "nemotron-vllm",
          provider: "vllm",
          requester_id: this.options.requesterId,
        },
        input: outputStage
          ? undefined
          : { messages: [{ content, role: "user" }] },
        output: outputStage
          ? { messages: [{ content, role: "assistant" }] }
          : undefined,
      }),
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        ...(this.options.apiKey ? { "X-API-Key": this.options.apiKey } : {}),
      },
      method: "POST",
      signal: requestSignal,
    });
    if (!response.ok)
      throw new Error(`HiddenLayer returned HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const parsed = HiddenLayerResponseSchema.parse(raw);
    const threatLevel = parsed.evaluation?.threat_level ?? parsed.threat_level;
    const legacyDetections: SecurityDetection[] = parsed.detections.map(
      (detection) => ({
        category:
          detection.category ?? detection.type ?? "runtime_security_detection",
        message: detection.message ?? "HiddenLayer policy detection",
        severity: normalizeSeverity(detection.severity ?? threatLevel),
      }),
    );
    const analysisDetections: SecurityDetection[] = parsed.analysis
      .filter((analysis) => analysis.detected)
      .map((analysis) => ({
        category: analysis.name,
        message: `HiddenLayer ${analysis.name} detection`,
        severity: normalizeSeverity(threatLevel),
      }));
    const detections = [...legacyDetections, ...analysisDetections];
    const actionValue = (
      parsed.evaluation?.action ?? parsed.action
    )?.toLowerCase();
    const highThreat = ["critical", "high"].includes(
      threatLevel?.toLowerCase() ?? "",
    );
    const detectionBlocks = parsed.detections.some(
      (detection) => detection.action?.toLowerCase() === "block",
    );
    const blocked = actionValue === "block" || detectionBlocks || highThreat;
    return {
      action: blocked ? "block" : actionValue === "redact" ? "redact" : "allow",
      blocked,
      details: parsed,
      detections,
      eventId:
        parsed.metadata?.event_id ??
        parsed.event_id ??
        parsed.interaction_id ??
        null,
      provider: "hiddenlayer",
      stage,
    };
  }
}
