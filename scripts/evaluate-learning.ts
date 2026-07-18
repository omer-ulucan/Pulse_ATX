import { readFile } from "node:fs/promises";

import { evaluateLearning } from "@pulse-atx/shared";
import { z } from "zod";

const EvaluationSchema = z.array(
  z.object({
    actual: z.number().nonnegative(),
    predictedWithMemory: z.number().nonnegative(),
    predictedWithoutMemory: z.number().nonnegative(),
  }),
);
const fixture: unknown = JSON.parse(
  await readFile(
    new URL("./fixtures/historical-incidents.json", import.meta.url),
    "utf8",
  ),
);
const metrics = evaluateLearning(EvaluationSchema.parse(fixture));
process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
