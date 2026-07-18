import type { NormalizedEvent } from "@pulse-atx/schemas";

export interface FeedPollResult {
  etag: string | null;
  events: NormalizedEvent[];
  lastModified: string | null;
  notModified: boolean;
}

export interface FeedAdapter {
  readonly source: NormalizedEvent["source"];
  poll(signal?: AbortSignal): Promise<FeedPollResult>;
}
