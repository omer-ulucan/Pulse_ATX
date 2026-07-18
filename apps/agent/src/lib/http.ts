export interface FetchJsonOptions {
  etag?: string | undefined;
  headers?: RequestInit["headers"] | undefined;
  lastModified?: string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
}

export interface JsonResponse {
  data: unknown;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

export async function fetchJson(
  url: string,
  options: FetchJsonOptions,
  fetcher: typeof fetch = fetch,
): Promise<JsonResponse> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.etag) headers.set("If-None-Match", options.etag);
  if (options.lastModified)
    headers.set("If-Modified-Since", options.lastModified);

  const response = await fetcher(url, { headers, signal });
  if (response.status === 304) {
    return {
      data: null,
      etag: options.etag ?? null,
      lastModified: options.lastModified ?? null,
      notModified: true,
    };
  }
  if (!response.ok) {
    throw new Error(`Feed request failed with HTTP ${response.status}`);
  }

  return {
    data: await response.json(),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    notModified: false,
  };
}
