export interface ChatModel {
  readonly modelName: string;
  complete(
    systemPrompt: string,
    userPrompt: string,
    signal?: AbortSignal,
  ): Promise<string>;
}

export interface InferenceMetricsSnapshot {
  averageLatencyMs: number;
  eventsProcessed: number;
  failedStructuredOutputs: number;
  modelName: string;
  p95LatencyMs: number;
  requests: number;
  serverStatus: "available" | "degraded" | "unknown";
  successfulStructuredOutputs: number;
}

export class InferenceMetrics {
  private readonly latencies: number[] = [];
  private requests = 0;
  private successfulStructuredOutputs = 0;
  private failedStructuredOutputs = 0;
  private serverStatus: InferenceMetricsSnapshot["serverStatus"] = "unknown";

  constructor(private readonly modelName: string) {}

  recordRequest(latencyMs: number, succeeded: boolean): void {
    this.requests += 1;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 1_000) this.latencies.shift();
    this.serverStatus = succeeded ? "available" : "degraded";
  }

  recordStructuredOutput(succeeded: boolean): void {
    if (succeeded) this.successfulStructuredOutputs += 1;
    else this.failedStructuredOutputs += 1;
  }

  snapshot(): InferenceMetricsSnapshot {
    const sorted = [...this.latencies].sort((left, right) => left - right);
    const average = sorted.length
      ? sorted.reduce((total, latency) => total + latency, 0) / sorted.length
      : 0;
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return {
      averageLatencyMs: Math.round(average),
      eventsProcessed:
        this.successfulStructuredOutputs + this.failedStructuredOutputs,
      failedStructuredOutputs: this.failedStructuredOutputs,
      modelName: this.modelName,
      p95LatencyMs: Math.round(sorted[p95Index] ?? 0),
      requests: this.requests,
      serverStatus: this.serverStatus,
      successfulStructuredOutputs: this.successfulStructuredOutputs,
    };
  }
}
