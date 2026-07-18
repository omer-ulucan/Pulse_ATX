import {
  NormalizedEventSchema,
  type NormalizedEvent,
} from "@pulse-atx/schemas";
import { z } from "zod";

import { createFingerprint } from "../lib/fingerprint.js";
import { fetchJson } from "../lib/http.js";
import type { FeedAdapter, FeedPollResult } from "./types.js";

const NoaaAlertFeatureSchema = z.object({
  geometry: z
    .object({ coordinates: z.unknown(), type: z.string() })
    .nullable()
    .optional(),
  id: z.string().optional(),
  properties: z
    .object({
      areaDesc: z.string().optional(),
      description: z.string().optional(),
      effective: z.string().optional(),
      ends: z.string().nullable().optional(),
      event: z.string(),
      expires: z.string().optional(),
      headline: z.string().nullable().optional(),
      id: z.string().optional(),
      onset: z.string().nullable().optional(),
      sent: z.string().optional(),
      severity: z.string().optional(),
      status: z.string().optional(),
      urgency: z.string().optional(),
    })
    .passthrough(),
  type: z.literal("Feature"),
});

const NoaaAlertsSchema = z.object({
  features: z.array(NoaaAlertFeatureSchema),
  type: z.literal("FeatureCollection"),
});

function collectCoordinates(value: unknown, points: [number, number][]): void {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    points.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectCoordinates(item, points);
}

function geometryCenter(
  coordinates: unknown,
): { latitude: number; longitude: number } | null {
  const points: [number, number][] = [];
  collectCoordinates(coordinates, points);
  if (points.length === 0) return null;
  const totals = points.reduce(
    (value, [longitude, latitude]) => ({
      latitude: value.latitude + latitude,
      longitude: value.longitude + longitude,
    }),
    { latitude: 0, longitude: 0 },
  );
  return {
    latitude: totals.latitude / points.length,
    longitude: totals.longitude / points.length,
  };
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function severityScore(severity: string | undefined): number {
  switch (severity?.toLowerCase()) {
    case "extreme":
      return 5;
    case "severe":
      return 4;
    case "moderate":
      return 3;
    case "minor":
      return 2;
    default:
      return 1;
  }
}

export function normalizeNoaaAlerts(input: unknown): NormalizedEvent[] {
  const feed = NoaaAlertsSchema.parse(input);
  return feed.features.map((feature, index) => {
    const properties = feature.properties;
    const externalId = properties.id?.trim() || feature.id?.trim();
    if (!externalId) {
      throw new Error(
        `NOAA alert ${index} is missing a stable source identifier`,
      );
    }
    const center = geometryCenter(feature.geometry?.coordinates);
    const sourceUpdatedAt = isoDate(
      properties.sent ?? properties.effective ?? properties.onset,
    );
    const summary = properties.headline?.trim() || properties.event;
    const payload = {
      ...properties,
      latitude: center?.latitude ?? null,
      longitude: center?.longitude ?? null,
      severity_score: severityScore(properties.severity),
    };
    const fingerprint = createFingerprint({
      event: properties.event,
      expires: properties.expires ?? properties.ends ?? null,
      severity: properties.severity ?? null,
      sourceUpdatedAt,
      status: properties.status ?? "Actual",
      urgency: properties.urgency ?? null,
    });

    return NormalizedEventSchema.parse({
      eventType: "weather_alert",
      externalId,
      fingerprint,
      latitude: center?.latitude ?? null,
      locationName: properties.areaDesc?.trim() || null,
      longitude: center?.longitude ?? null,
      payload,
      source: "noaa_weather",
      sourceCreatedAt: isoDate(properties.effective ?? properties.sent),
      sourceUpdatedAt,
      status: properties.status?.trim() || "Actual",
      summary,
    });
  });
}

export class NoaaAlertsFeedAdapter implements FeedAdapter {
  readonly source = "noaa_weather" as const;
  private etag: string | undefined;
  private lastModified: string | undefined;

  constructor(
    private readonly url: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
    private readonly userAgent = "PulseATX/0.1",
  ) {}

  async poll(signal?: AbortSignal): Promise<FeedPollResult> {
    const response = await fetchJson(
      this.url,
      {
        etag: this.etag,
        headers: {
          Accept: "application/geo+json",
          "User-Agent": this.userAgent,
        },
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
      events: response.notModified ? [] : normalizeNoaaAlerts(response.data),
      lastModified: response.lastModified,
      notModified: response.notModified,
    };
  }
}
