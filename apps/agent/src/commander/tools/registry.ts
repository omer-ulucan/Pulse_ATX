import { createFingerprint } from "../../lib/fingerprint.js";
import {
  ToolNameSchema,
  type AgentTool,
  type ToolContext,
  type ToolName,
  type ValidatedToolCall,
} from "./types.js";

interface RegisteredTool {
  definition: AgentTool<unknown, unknown>;
  execute(
    input: unknown,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export class AgentToolRegistry {
  private readonly tools = new Map<ToolName, RegisteredTool>();

  register<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Agent tool ${tool.name} is already registered`);
    }
    this.tools.set(tool.name, {
      definition: tool as AgentTool<unknown, unknown>,
      execute: async (input, context, signal) => {
        const parsedInput = tool.inputSchema.parse(input);
        const result = await tool.execute(parsedInput, context, signal);
        return tool.outputSchema.parse(result);
      },
    });
    return this;
  }

  names(): ToolName[] {
    return [...this.tools.keys()];
  }

  resolve(name: unknown): RegisteredTool {
    const toolName = ToolNameSchema.parse(name);
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Agent tool ${toolName} is not registered`);
    return tool;
  }

  validateCall(call: ValidatedToolCall): ValidatedToolCall {
    const tool = this.resolve(call.tool);
    return {
      arguments: tool.definition.inputSchema.parse(call.arguments),
      tool: tool.definition.name,
    };
  }

  fingerprint(call: ValidatedToolCall, context: ToolContext): string {
    const validated = this.validateCall(call);
    const strategy = this.resolve(validated.tool).definition
      .idempotencyStrategy;
    return createFingerprint({
      arguments: validated.arguments,
      incidentId: context.incidentId,
      missionId:
        strategy === "incident_singleton" ? undefined : context.missionId,
      strategy,
      tool: validated.tool,
      wakeCycle:
        strategy === "mission_arguments" || strategy === "read_only"
          ? context.wakeCycle
          : undefined,
    });
  }

  async executeValidated(
    call: ValidatedToolCall,
    context: ToolContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const validated = this.validateCall(call);
    const registered = this.resolve(validated.tool);
    const timeout = AbortSignal.timeout(registered.definition.timeoutMs);
    const executionSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    context.logger("agent tool execution started", {
      incidentId: context.incidentId,
      missionId: context.missionId,
      missionStepId: context.missionStepId,
      toolName: validated.tool,
    });
    const startedAt = performance.now();
    try {
      const output = await registered.execute(
        validated.arguments,
        context,
        executionSignal,
      );
      context.logger("agent tool execution completed", {
        latencyMs: Math.round(performance.now() - startedAt),
        missionId: context.missionId,
        missionStepId: context.missionStepId,
        toolName: validated.tool,
      });
      return output;
    } catch (error) {
      context.logger("agent tool execution failed", {
        error: error instanceof Error ? error.message : "Unknown tool failure",
        missionId: context.missionId,
        missionStepId: context.missionStepId,
        toolName: validated.tool,
      });
      throw error;
    }
  }
}
