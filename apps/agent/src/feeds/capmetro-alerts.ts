import {
  NormalizedEventSchema,
  type NormalizedEvent,
} from "@pulse-atx/schemas";
import { z } from "zod";

import { createFingerprint } from "../lib/fingerprint.js";
import { fetchJson } from "../lib/http.js";
import type { FeedAdapter, FeedPollResult } from "./types.js";

const TranslationSchema = z.object({
  language: z.string().optional(),
  text: z.string().min(1),
});

const TranslatedStringSchema = z.object({
  translation: z.array(TranslationSchema).min(1),
});

const CapMetroEntitySchema = z.object({
  alert: z.object({
    activePeriod: z
      .array(
        z.object({
          end: z.number().int().nonnegative().optional(),
          start: z.number().int().nonnegative().optional(),
        }),
      )
      .default([]),
    cause: z.string().optional(),
    descriptionText: TranslatedStringSchema.optional(),
    effect: z.string().optional(),
    headerText: TranslatedStringSchema.optional(),
    informedEntity: z
      .array(
        z.object({
          agencyId: z.string().optional(),
          routeId: z.string().optional(),
          stopId: z.string().optional(),
          trip: z.object({ routeId: z.string().optional() }).optional(),
        }),
      )
      .default([]),
    url: TranslatedStringSchema.optional(),
  }),
  id: z.string().min(1),
});

const CapMetroFeedSchema = z.object({
  entity: z.array(CapMetroEntitySchema),
  header: z
    .object({
      incrementality: z.string().optional(),
      timestamp: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
});

export interface TransitAnomaly {
  delayMinutes: number;
  effect: string;
  severity: number;
}

export function deriveTransitAnomaly(
  effect = "UNKNOWN_EFFECT",
): TransitAnomaly {
  switch (effect.toUpperCase()) {
    case "NO_SERVICE":
      return { delayMinutes: 90, effect, severity: 5 };
    case "SIGNIFICANT_DELAYS":
      return { delayMinutes: 45, effect, severity: 4 };
    case "DETOUR":
    case "REDUCED_SERVICE":
      return { delayMinutes: 25, effect, severity: 3 };
    case "MODIFIED_SERVICE":
    case "STOP_MOVED":
      return { delayMinutes: 15, effect, severity: 2 };
    default:
      return { delayMinutes: 10, effect, severity: 1 };
  }
}

function translatedText(
  value: z.infer<typeof TranslatedStringSchema> | undefined,
): string | null {
  if (!value) return null;
  return (
    value.translation.find((item) => item.language?.startsWith("en"))?.text ??
    value.translation[0]?.text ??
    null
  );
}

function unixIso(value: number | undefined): string | null {
  if (value === undefined) return null;
  return new Date(value * 1_000).toISOString();
}

export function normalizeCapMetroAlerts(input: unknown): NormalizedEvent[] {
  const feed = CapMetroFeedSchema.parse(input);
  return feed.entity.map((entity) => {
    const alert = entity.alert;
    const anomaly = deriveTransitAnomaly(alert.effect);
    const routeIds = [
      ...new Set(
        alert.informedEntity
          .flatMap((item) => [item.routeId, item.trip?.routeId])
          .filter((routeId): routeId is string => Boolean(routeId)),
      ),
    ];
    const header = translatedText(alert.headerText) ?? "CapMetro service alert";
    const description = translatedText(alert.descriptionText);
    const firstPeriod = alert.activePeriod[0];
    const sourceUpdatedAt = unixIso(feed.header.timestamp);
    const payload = {
      active_period: alert.activePeriod,
      cause: alert.cause ?? "UNKNOWN_CAUSE",
      description,
      effect: anomaly.effect,
      header,
      route_ids: routeIds,
      severity_score: anomaly.severity,
      transit_delay_minutes: anomaly.delayMinutes,
    };
    const fingerprint = createFingerprint({
      activePeriod: alert.activePeriod,
      cause: alert.cause ?? null,
      description,
      effect: anomaly.effect,
      routeIds,
    });

    return NormalizedEventSchema.parse({
      eventType: "transit_disruption",
      externalId: entity.id.trim(),
      fingerprint,
      latitude: null,
      locationName:
        routeIds.length > 0
          ? `CapMetro routes ${routeIds.join(", ")}`
          : "CapMetro",
      longitude: null,
      payload,
      source: "capmetro",
      sourceCreatedAt: unixIso(firstPeriod?.start),
      sourceUpdatedAt,
      status:
        firstPeriod?.end && firstPeriod.end * 1_000 < Date.now()
          ? "EXPIRED"
          : "ACTIVE",
      summary: description ? `${header}: ${description}` : header,
    });
  });
}

export class CapMetroAlertsFeedAdapter implements FeedAdapter {
  readonly source = "capmetro" as const;
  private etag: string | undefined;
  private lastModified: string | undefined;

  constructor(
    private readonly url: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async poll(signal?: AbortSignal): Promise<FeedPollResult> {
    const response = await fetchJson(
      this.url,
      {
        etag: this.etag,
        lastModified: this.lastModified,
        signal,
        timeoutMs: this.timeoutMs,
      },
      this.fetcher,
    );
    if (response.etag) this.etag = response.etag;
    if (response.lastModified) this.lastModified = response.lastModified;
    return {
      etag: response.etag,
      events: response.notModified
        ? []
        : normalizeCapMetroAlerts(response.data),
      lastModified: response.lastModified,
      notModified: response.notModified,
    };
  }
}
