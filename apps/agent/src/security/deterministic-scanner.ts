import type {
  SecurityDetection,
  SecurityScanner,
  SecurityScanResult,
  SecurityStage,
} from "./types.js";

const injectionPattern =
  /ignore (all |any )?(previous|prior) instructions|system prompt|developer message|override (the )?policy/i;
const exfiltrationPattern =
  /https?:\/\/(?!data\.austintexas\.gov|api\.weather\.gov)|send (all|the) (stored|private)|api[_ -]?key|service[_ -]?role/i;

export class DeterministicSecurityScanner implements SecurityScanner {
  scan(
    stage: SecurityStage,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<SecurityScanResult> {
    const detections: SecurityDetection[] = [];
    if (injectionPattern.test(content)) {
      detections.push({
        category: "prompt_injection",
        message: "Instruction override language detected",
        severity: "high",
      });
    }
    if (exfiltrationPattern.test(content)) {
      detections.push({
        category: "data_exfiltration",
        message: "Unauthorized destination or secret request detected",
        severity: "critical",
      });
    }
    const blocked = detections.length > 0;
    return Promise.resolve({
      action: blocked ? "block" : "allow",
      blocked,
      details: { metadata, mode: "deterministic-demo" },
      detections,
      eventId: null,
      provider: "hiddenlayer-mock",
      stage,
    });
  }
}
