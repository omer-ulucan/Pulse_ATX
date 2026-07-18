import { PublicEnvironmentSchema } from "@pulse-atx/schemas";
import { z } from "zod";

const MemorySchema = z.object({
  created_at: z.string(),
  id: z.uuid(),
  lesson: z.record(z.string(), z.unknown()),
  quality_score: z.number(),
  summary: z.string(),
});

const OutcomeSchema = z.object({
  actual_duration_minutes: z.number().int().nullable(),
  created_at: z.string(),
  id: z.uuid(),
  predicted_duration_minutes: z.number().int().nullable(),
  prediction_error: z.number().int().nullable(),
});

export type LearningMemory = z.infer<typeof MemorySchema>;
export type LearningOutcome = z.infer<typeof OutcomeSchema>;

export interface LearningSnapshot {
  configured: boolean;
  error: string | null;
  memories: LearningMemory[];
  outcomes: LearningOutcome[];
}

async function fetchRows<T>(
  url: string,
  anonKey: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    cache: "no-store",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!response.ok)
    throw new Error(`Supabase returned HTTP ${response.status}`);
  return schema.parse(await response.json());
}

export async function getLearningSnapshot(): Promise<LearningSnapshot> {
  const environment = PublicEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!anonKey || !url) {
    return { configured: false, error: null, memories: [], outcomes: [] };
  }

  try {
    const [memories, outcomes] = await Promise.all([
      fetchRows(
        url,
        anonKey,
        "incident_memories?select=id,summary,lesson,quality_score,created_at&order=created_at.desc&limit=20",
        z.array(MemorySchema),
      ),
      fetchRows(
        url,
        anonKey,
        "incident_outcomes?select=id,predicted_duration_minutes,actual_duration_minutes,prediction_error,created_at&order=created_at.desc&limit=100",
        z.array(OutcomeSchema),
      ),
    ]);
    return { configured: true, error: null, memories, outcomes };
  } catch (error) {
    return {
      configured: true,
      error:
        error instanceof Error ? error.message : "Learning snapshot failed",
      memories: [],
      outcomes: [],
    };
  }
}
