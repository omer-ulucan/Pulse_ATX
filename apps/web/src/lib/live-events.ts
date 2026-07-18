import { PublicEnvironmentSchema } from "@pulse-atx/schemas";
import { z } from "zod";

const LiveEventSchema = z.object({
  event_type: z.string(),
  external_id: z.string(),
  first_seen_at: z.string(),
  id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  processing_status: z.string(),
  revision: z.number().int().positive(),
  source: z.string(),
});

export type LiveEvent = z.infer<typeof LiveEventSchema>;

export interface LiveEventsResult {
  configured: boolean;
  events: LiveEvent[];
  error: string | null;
}

export async function getLiveEvents(): Promise<LiveEventsResult> {
  const environment = PublicEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (
    !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !environment.NEXT_PUBLIC_SUPABASE_URL
  ) {
    return { configured: false, events: [], error: null };
  }

  try {
    const response = await fetch(
      `${environment.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/raw_events?select=id,source,external_id,event_type,payload,revision,first_seen_at,processing_status&order=first_seen_at.desc&limit=25`,
      {
        cache: "no-store",
        headers: {
          apikey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${environment.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        },
      },
    );
    if (!response.ok)
      throw new Error(`Supabase returned HTTP ${response.status}`);
    const events = z
      .array(LiveEventSchema)
      .parse((await response.json()) as unknown);
    return { configured: true, events, error: null };
  } catch (error) {
    return {
      configured: true,
      events: [],
      error:
        error instanceof Error ? error.message : "Unable to load live events",
    };
  }
}
