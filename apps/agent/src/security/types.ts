export type SecurityStage =
  | "alert_output"
  | "feed_input"
  | "model_output"
  | "model_prompt"
  | "tool_call"
  | "tool_result";

export type SecuritySeverity = "critical" | "high" | "low" | "medium";

export interface SecurityDetection {
  category: string;
  message: string;
  severity: SecuritySeverity;
}

export interface SecurityScanResult {
  action: "allow" | "block" | "redact";
  blocked: boolean;
  details: Record<string, unknown>;
  detections: SecurityDetection[];
  eventId: string | null;
  provider: string;
  stage: SecurityStage;
}

export interface SecurityScanner {
  scan(
    stage: SecurityStage,
    content: string,
    metadata?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SecurityScanResult>;
}

export class SecurityBlockError extends Error {
  constructor(readonly finding: SecurityScanResult) {
    super(`Security policy blocked ${finding.stage}`);
    this.name = "SecurityBlockError";
  }
}

export async function enforceSecurityScan(
  scanner: SecurityScanner | undefined,
  stage: SecurityStage,
  content: string,
  metadata: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<SecurityScanResult | null> {
  if (!scanner) return null;
  const finding = await scanner.scan(stage, content, metadata, signal);
  if (finding.blocked) throw new SecurityBlockError(finding);
  return finding;
}

export class ToolSecurityBoundary {
  constructor(private readonly scanner: SecurityScanner) {}

  scanCall(
    toolName: string,
    argumentsValue: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SecurityScanResult | null> {
    return enforceSecurityScan(
      this.scanner,
      "tool_call",
      JSON.stringify({ arguments: argumentsValue, toolName }),
      { toolName },
      signal,
    );
  }

  scanResult(
    toolName: string,
    result: unknown,
    signal?: AbortSignal,
  ): Promise<SecurityScanResult | null> {
    return enforceSecurityScan(
      this.scanner,
      "tool_result",
      JSON.stringify({ result, toolName }),
      { toolName },
      signal,
    );
  }
}
