import {
  NormalizedEventSchema,
  type NormalizedEvent,
} from "@pulse-atx/schemas";
import { z } from "zod";

import { createFingerprint } from "../lib/fingerprint.js";
import { fetchJson } from "../lib/http.js";
import type { FeedAdapter, FeedPollResult } from "./types.js";

const nullableCoordinate = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce.number().nullable(),
);

const AustinTrafficRecordSchema = z
  .object({
    address: z.string().optional(),
    description: z.string().optional(),
    id: z.string().optional(),
    incident_id: z.string().optional(),
    issue_reported: z.string().optional(),
    latitude: nullableCoordinate,
    location: z
      .object({
        latitude: nullableCoordinate.optional(),
        longitude: nullableCoordinate.optional(),
      })
      .optional(),
    longitude: nullableCoordinate,
    published_date: z.string().optional(),
    status: z.string().optional(),
    traffic_report_id: z.string().optional(),
    traffic_report_status: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const AustinTrafficFeedSchema = z.array(AustinTrafficRecordSchema);

function optionalIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeAustinTrafficFeed(input: unknown): NormalizedEvent[] {
  const records = AustinTrafficFeedSchema.parse(input);
  return records.map((record, index) => {
    const externalId = [record.traffic_report_id, record.incident_id, record.id]
      .map((value) => value?.trim())
      .find((value): value is string => Boolean(value));
    if (!externalId) {
      throw new Error(
        `Austin traffic record ${index} is missing a stable source identifier`,
      );
    }
    const latitude = record.latitude ?? record.location?.latitude ?? null;
    const longitude = record.longitude ?? record.location?.longitude ?? null;
    const status = record.traffic_report_status ?? record.status ?? "UNKNOWN";
    const issue =
      record.issue_reported ?? record.description ?? "Traffic incident";
    const locationName = record.address ?? null;
    const fingerprint = createFingerprint({
      issue,
      latitude,
      locationName,
      longitude,
      sourceUpdatedAt: record.updated_at ?? record.published_date ?? null,
      status,
    });

    return NormalizedEventSchema.parse({
      eventType: "traffic_incident",
      externalId,
      fingerprint,
      latitude,
      locationName,
      longitude,
      payload: record,
      source: "austin_traffic",
      sourceCreatedAt: optionalIsoDate(record.published_date),
      sourceUpdatedAt: optionalIsoDate(
        record.updated_at ?? record.published_date,
      ),
      status,
      summary: locationName ? `${issue} at ${locationName}` : issue,
    });
  });
}

export class AustinTrafficFeedAdapter implements FeedAdapter {
  readonly source = "austin_traffic" as const;
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
        : normalizeAustinTrafficFeed(response.data),
      lastModified: response.lastModified,
      notModified: response.notModified,
    };
  }
}
