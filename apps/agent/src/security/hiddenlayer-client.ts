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
    detections: z.array(DetectionSchema).default([]),
    event_id: z.string().optional(),
    interaction_id: z.string().optional(),
    threat_level: z.string().optional(),
  })
  .passthrough();

export interface HiddenLayerClientOptions {
  apiKey: string;
  baseUrl: string;
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

  constructor(
    private readonly options: HiddenLayerClientOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/detection/v1/interactions`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async scan(
    stage: SecurityStage,
    content: string,
    metadata: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<SecurityScanResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const outputStage = isOutputStage(stage);
    const response = await this.fetcher(this.endpoint, {
      body: JSON.stringify({
        metadata: { ...metadata, stage },
        model: "nemotron-vllm",
        output: outputStage ? content : undefined,
        prompt: outputStage ? undefined : content,
        requester_id: this.options.requesterId,
      }),
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        "X-API-Key": this.options.apiKey,
      },
      method: "POST",
      signal: requestSignal,
    });
    if (!response.ok)
      throw new Error(`HiddenLayer returned HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const parsed = HiddenLayerResponseSchema.parse(raw);
    const detections: SecurityDetection[] = parsed.detections.map(
      (detection) => ({
        category:
          detection.category ?? detection.type ?? "runtime_security_detection",
        message: detection.message ?? "HiddenLayer policy detection",
        severity: normalizeSeverity(detection.severity ?? parsed.threat_level),
      }),
    );
    const actionValue = parsed.action?.toLowerCase();
    const highThreat = ["critical", "high"].includes(
      parsed.threat_level?.toLowerCase() ?? "",
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
      eventId: parsed.event_id ?? parsed.interaction_id ?? null,
      provider: "hiddenlayer",
      stage,
    };
  }
}
