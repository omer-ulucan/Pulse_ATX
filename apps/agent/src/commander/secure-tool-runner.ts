import { SecurityBlockError } from "../security/types.js";
import type { ToolSecurityBoundary } from "../security/types.js";
import type {
  MissionToolExecutionOutcome,
  MissionToolExecutionRequest,
  MissionToolRunner,
} from "./mission-engine.js";
import type { MissionRuntimeRepository } from "./mission-repository.js";
import type { AgentToolRegistry } from "./tools/registry.js";
import type {
  AgentTool,
  ToolContext,
  ToolLog,
  ToolOperations,
} from "./tools/types.js";

export interface ToolPolicyEnforcer {
  enforce(tool: AgentTool<unknown, unknown>): void;
}

export class OpenShellToolPolicy implements ToolPolicyEnforcer {
  enforce(tool: AgentTool<unknown, unknown>): void {
    if (!["none", "supabase"].includes(tool.securityPolicy.networkAccess)) {
      throw new Error(
        `OpenShell policy denies network class ${tool.securityPolicy.networkAccess}`,
      );
    }
    if (
      tool.securityPolicy.networkAccess === "none" &&
      tool.timeoutMs > 5_000
    ) {
      throw new Error("Local-only tool exceeds its bounded OpenShell runtime");
    }
  }
}

export interface SecureToolRunnerOptions {
  approvalConfidenceThreshold?: number | undefined;
  logger?: ToolLog | undefined;
}

function majorRouteCount(routes: string[]): number {
  const majorRoutes = new Set([
    "1",
    "7",
    "10",
    "20",
    "30",
    "300",
    "311",
    "801",
    "803",
  ]);
  return routes.filter((route) => majorRoutes.has(route.trim().toUpperCase()))
    .length;
}

export class SecureMissionToolRunner implements MissionToolRunner {
  private readonly approvalConfidenceThreshold: number;
  private readonly logger: ToolLog;

  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly repository: MissionRuntimeRepository,
    private readonly security: ToolSecurityBoundary,
    private readonly policy: ToolPolicyEnforcer,
    private readonly operations: ToolOperations,
    options: SecureToolRunnerOptions = {},
  ) {
    this.approvalConfidenceThreshold =
      options.approvalConfidenceThreshold ?? 0.65;
    this.logger = options.logger ?? (() => undefined);
  }

  async execute(
    request: MissionToolExecutionRequest,
  ): Promise<MissionToolExecutionOutcome> {
    const call = this.registry.validateCall({
      arguments: request.step.toolArguments,
      tool: request.step.toolName,
    });
    const definition = this.registry.resolve(call.tool).definition;
    const context: ToolContext = {
      affectedMajorRouteCount: majorRouteCount(request.snapshot.affectedRoutes),
      confidence: request.snapshot.confidence,
      incidentId: request.mission.incidentId,
      logger: this.logger,
      missionId: request.mission.id,
      missionStepId: request.step.id,
      operations: this.operations,
      securityConfidence: "confident",
      severity: request.snapshot.severity,
      wakeCycle: request.mission.wakeCycle,
    };
    const fingerprint = this.registry.fingerprint(call, context);
    let securityStatus = "hiddenlayer_passed";
    let explicitSecurityBlock: Error | null = null;

    try {
      await this.security.scanCall(
        call.tool,
        call.arguments as Record<string, unknown>,
        request.signal,
      );
    } catch (error) {
      if (error instanceof SecurityBlockError) {
        securityStatus = "hiddenlayer_blocked";
        explicitSecurityBlock = error;
      } else {
        securityStatus = "hiddenlayer_ambiguous";
        context.securityConfidence = "ambiguous";
        this.logger("HiddenLayer tool-call scan was ambiguous", {
          error:
            error instanceof Error ? error.message : "Unknown scan failure",
          missionId: request.mission.id,
          toolName: call.tool,
        });
      }
    }

    try {
      this.policy.enforce(definition);
    } catch (error) {
      securityStatus = "openshell_blocked";
      explicitSecurityBlock =
        error instanceof Error
          ? error
          : new Error("OpenShell policy blocked tool");
    }

    const requiresApproval =
      !explicitSecurityBlock &&
      (definition.requiresApproval(call.arguments, context) ||
        context.securityConfidence === "ambiguous" ||
        (definition.securityPolicy.impact === "high" &&
          (request.snapshot.severity === 5 ||
            context.affectedMajorRouteCount > 1 ||
            request.snapshot.confidence < this.approvalConfidenceThreshold ||
            !definition.securityPolicy.reversible)));
    let execution = await this.repository.beginToolExecution({
      approvalRequired: requiresApproval,
      arguments: call.arguments as Record<string, unknown>,
      argumentsFingerprint: fingerprint,
      missionId: request.mission.id,
      missionStepId: request.step.id,
      securityStatus,
      toolName: call.tool,
    });
    await this.repository.appendTimeline({
      eventType: explicitSecurityBlock
        ? "mission_tool_security_blocked"
        : context.securityConfidence === "ambiguous"
          ? "mission_tool_security_ambiguous"
          : "mission_tool_security_passed",
      incidentId: request.mission.incidentId,
      message: explicitSecurityBlock
        ? "Tool call security scan blocked"
        : context.securityConfidence === "ambiguous"
          ? "Tool call security scan requires operator review"
          : "Tool call security scan passed",
      metadata: {
        securityStatus,
        toolExecutionId: execution.id,
        toolName: call.tool,
      },
      missionId: request.mission.id,
    });

    if (explicitSecurityBlock) {
      if (execution.completedAt === null) {
        execution = await this.repository.finishToolExecution({
          error: explicitSecurityBlock.message,
          executionId: execution.id,
          latencyMs: 0,
          result: { blocked: true },
          securityStatus,
          status: "blocked",
        });
      }
      return {
        error: execution.error ?? explicitSecurityBlock.message,
        result: execution.result,
        status: "failed",
      };
    }

    if (execution.status === "completed") {
      return this.completedOutcome(call.tool, execution.result);
    }
    if (execution.approvalStatus === "rejected") {
      return {
        reason: "Operator rejected the protected mission action",
        result: { executionId: execution.id },
        status: "cancelled",
      };
    }
    if (execution.approvalStatus === "pending") {
      return {
        result: {
          action: call.tool,
          arguments: call.arguments,
          decisionAudit: request.audit,
          executionId: execution.id,
          rationale: request.step.rationale,
        },
        status: "waiting_approval",
      };
    }
    if (
      execution.status === "failed" ||
      (execution.status === "blocked" &&
        execution.approvalStatus !== "approved")
    ) {
      return {
        error: execution.error ?? "Prior tool execution failed",
        result: execution.result,
        status: "failed",
      };
    }

    execution = await this.repository.markToolExecutionRunning(execution.id);
    const startedAt = performance.now();
    try {
      const result = await this.registry.executeValidated(
        call,
        context,
        request.signal,
      );
      await this.security.scanResult(call.tool, result, request.signal);
      execution = await this.repository.finishToolExecution({
        error: null,
        executionId: execution.id,
        latencyMs: Math.round(performance.now() - startedAt),
        result,
        securityStatus: `${securityStatus}:result_passed`,
        status: "completed",
      });
      return this.completedOutcome(call.tool, execution.result);
    } catch (error) {
      const blocked = error instanceof SecurityBlockError;
      execution = await this.repository.finishToolExecution({
        error: error instanceof Error ? error.message : "Unknown tool failure",
        executionId: execution.id,
        latencyMs: Math.round(performance.now() - startedAt),
        result: { blocked },
        securityStatus: blocked ? "hiddenlayer_result_blocked" : securityStatus,
        status: blocked ? "blocked" : "failed",
      });
      return {
        error: execution.error ?? "Tool execution failed",
        result: execution.result,
        status: "failed",
      };
    }
  }

  private completedOutcome(
    toolName: string,
    result: unknown,
  ): MissionToolExecutionOutcome {
    if (
      toolName === "schedule_incident_recheck" &&
      typeof result === "object" &&
      result !== null &&
      "nextWakeAt" in result &&
      typeof result.nextWakeAt === "string"
    ) {
      return { nextWakeAt: result.nextWakeAt, result, status: "waiting" };
    }
    return { result, status: "completed" };
  }
}
