import { z } from "zod";

import { ToolNameSchema } from "./tools/types.js";

export const MissionStatusSchema = z.enum([
  "planning",
  "active",
  "waiting",
  "waiting_approval",
  "completed",
  "cancelled",
  "failed",
]);

export const MissionStepStatusSchema = z.enum([
  "planned",
  "running",
  "waiting",
  "waiting_approval",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export const MissionStepSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
  order: z.number().int().positive().max(8),
  rationale: z.string().min(5).max(1_000),
  requiresFreshObservation: z.boolean(),
  tool: ToolNameSchema,
});

function hasSequentialUniqueOrders(steps: Array<{ order: number }>): boolean {
  return steps.every((step, index) => step.order === index + 1);
}

export const MissionPlanSchema = z
  .object({
    assumptions: z.array(z.string().min(1).max(500)).max(8),
    goal: z.string().min(10).max(1_000),
    priority: z.number().int().min(1).max(5),
    recheckAfterSeconds: z.number().int().min(15).max(300),
    steps: z.array(MissionStepSchema).min(1).max(8),
    successCriteria: z.array(z.string().min(1).max(500)).min(1).max(5),
  })
  .superRefine((plan, context) => {
    if (!hasSequentialUniqueOrders(plan.steps)) {
      context.addIssue({
        code: "custom",
        message: "Mission step orders must be unique and sequential from 1",
        path: ["steps"],
      });
    }
    if (
      !plan.steps.some((step) => step.tool === "schedule_incident_recheck") &&
      !plan.steps.some((step) => step.tool === "close_incident")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A mission plan must schedule a future observation or explicitly close the incident",
        path: ["steps"],
      });
    }
  });

export const MissionRevisionSchema = z
  .object({
    decision: z.enum([
      "continue",
      "revise",
      "escalate",
      "deescalate",
      "complete",
      "cancel",
    ]),
    explanation: z.string().min(5).max(1_000),
    newSeverity: z.number().int().min(1).max(5).optional(),
    recheckAfterSeconds: z.number().int().min(15).max(300).optional(),
    replacementSteps: z.array(MissionStepSchema).min(1).max(8).optional(),
    revisedGoal: z.string().min(10).max(1_000).optional(),
  })
  .superRefine((revision, context) => {
    if (
      revision.replacementSteps &&
      !hasSequentialUniqueOrders(revision.replacementSteps)
    ) {
      context.addIssue({
        code: "custom",
        message: "Replacement step orders must be sequential from 1",
        path: ["replacementSteps"],
      });
    }
    if (
      ["revise", "escalate", "deescalate"].includes(revision.decision) &&
      !revision.replacementSteps &&
      revision.newSeverity === undefined &&
      !revision.revisedGoal
    ) {
      context.addIssue({
        code: "custom",
        message: "A material revision must change severity, goal, or steps",
      });
    }
  });

export const CounterfactualAuditSchema = z.object({
  alternatives: z
    .array(
      z.object({
        confidence: z.number().min(0).max(1),
        expectedBenefit: z.string().min(1).max(500),
        expectedRisk: z.string().min(1).max(500),
        name: z.string().min(1).max(200),
        reversibility: z.enum(["high", "medium", "low"]),
      }),
    )
    .min(2)
    .max(3),
  selectedAction: z.string().min(1).max(500),
  selectionReason: z.string().min(5).max(1_000),
});

export type CounterfactualAudit = z.infer<typeof CounterfactualAuditSchema>;
export type MissionPlan = z.infer<typeof MissionPlanSchema>;
export type MissionRevision = z.infer<typeof MissionRevisionSchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type MissionStep = z.infer<typeof MissionStepSchema>;
export type MissionStepStatus = z.infer<typeof MissionStepStatusSchema>;
