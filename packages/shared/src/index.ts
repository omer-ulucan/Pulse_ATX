export const APP_NAME = "PulseATX";

import { posix } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

const AllowRuleSchema = z.object({
  allow: z.object({ method: z.string().min(1), path: z.string().min(1) }),
});

const EndpointSchema = z.object({
  access: z.enum(["full", "read-only", "read-write"]).optional(),
  enforcement: z.enum(["audit", "enforce"]).optional(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  protocol: z.string().optional(),
  rules: z.array(AllowRuleSchema).optional(),
});

const OpenShellPolicySchema = z.object({
  filesystem_policy: z
    .object({
      include_workdir: z.boolean().optional(),
      read_only: z.array(z.string().startsWith("/")).default([]),
      read_write: z.array(z.string().startsWith("/")).default([]),
    })
    .optional(),
  landlock: z
    .object({ compatibility: z.enum(["best_effort", "hard_requirement"]) })
    .optional(),
  network_policies: z.record(
    z.string(),
    z.object({
      binaries: z.array(z.object({ path: z.string().startsWith("/") })).min(1),
      endpoints: z.array(EndpointSchema).min(1),
      name: z.string().optional(),
    }),
  ),
  process: z
    .object({ run_as_group: z.string(), run_as_user: z.string() })
    .optional(),
  version: z.literal(1),
});

export type OpenShellPolicy = z.infer<typeof OpenShellPolicySchema>;

export function parseOpenShellPolicy(yaml: string): OpenShellPolicy {
  return OpenShellPolicySchema.parse(parseYaml(yaml) as unknown);
}

function patternExpression(pattern: string, separator: string): RegExp {
  const doubleStar = "__DOUBLE_STAR__";
  const escaped = pattern
    .replaceAll("**", doubleStar)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", `[^${separator}]*`)
    .replaceAll(doubleStar, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesHost(pattern: string, host: string): boolean {
  return patternExpression(pattern, ".").test(host);
}

function matchesPath(pattern: string, path: string): boolean {
  return patternExpression(pattern, "/").test(path);
}

function methodAllowed(
  endpoint: z.infer<typeof EndpointSchema>,
  method: string,
  pathname: string,
): boolean {
  if (endpoint.rules) {
    return endpoint.rules.some(
      (rule) =>
        (rule.allow.method === "*" || rule.allow.method === method) &&
        matchesPath(rule.allow.path, pathname),
    );
  }
  if (endpoint.access === "full") return true;
  if (endpoint.access === "read-write")
    return ["GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].includes(method);
  if (endpoint.access === "read-only")
    return ["GET", "HEAD", "OPTIONS"].includes(method);
  return endpoint.protocol === undefined;
}

export function isOpenShellDestinationAllowed(
  policy: OpenShellPolicy,
  request: { binaryPath: string; method: string; url: string },
): boolean {
  const url = new URL(request.url);
  const port = Number(
    url.port ||
      (url.protocol === "https:"
        ? "443"
        : url.protocol === "http:"
          ? "80"
          : "0"),
  );
  const method = request.method.toUpperCase();
  return Object.values(policy.network_policies).some(
    (entry) =>
      entry.binaries.some((binary) =>
        patternExpression(binary.path, "/").test(request.binaryPath),
      ) &&
      entry.endpoints.some(
        (endpoint) =>
          endpoint.enforcement !== "audit" &&
          endpoint.port === port &&
          matchesHost(endpoint.host, url.hostname) &&
          methodAllowed(endpoint, method, `${url.pathname}${url.search}`),
      ),
  );
}

export type OpenShellFilesystemAccess =
  | "inaccessible"
  | "read-only"
  | "read-write";

export function openShellFilesystemAccess(
  policy: OpenShellPolicy,
  path: string,
): OpenShellFilesystemAccess {
  const filesystem = policy.filesystem_policy;
  if (!filesystem || path.includes("..")) return "inaccessible";
  const normalized = posix.normalize(path);
  const matches = (allowedPath: string) =>
    normalized === allowedPath || normalized.startsWith(`${allowedPath}/`);
  const readWrite = filesystem.read_write
    .filter(matches)
    .sort((first, second) => second.length - first.length)[0];
  const readOnly = filesystem.read_only
    .filter(matches)
    .sort((first, second) => second.length - first.length)[0];
  if (readOnly && (!readWrite || readOnly.length >= readWrite.length))
    return "read-only";
  if (readWrite) return "read-write";
  return "inaccessible";
}

export function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Operation aborted"),
      );
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Operation aborted"),
        );
      },
      { once: true },
    );
  });
}

export async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

export interface LearningEvaluationRecord {
  actual: number;
  predictedWithMemory: number;
  predictedWithoutMemory: number;
}

export interface LearningEvaluation {
  improvementPercent: number;
  sampleCount: number;
  withMemoryMae: number;
  withoutMemoryMae: number;
}

export function evaluateLearning(
  records: readonly LearningEvaluationRecord[],
): LearningEvaluation {
  if (records.length === 0) {
    return {
      improvementPercent: 0,
      sampleCount: 0,
      withMemoryMae: 0,
      withoutMemoryMae: 0,
    };
  }
  const withoutMemoryMae =
    records.reduce(
      (total, record) =>
        total + Math.abs(record.predictedWithoutMemory - record.actual),
      0,
    ) / records.length;
  const withMemoryMae =
    records.reduce(
      (total, record) =>
        total + Math.abs(record.predictedWithMemory - record.actual),
      0,
    ) / records.length;
  return {
    improvementPercent:
      withoutMemoryMae === 0
        ? 0
        : Math.round(
            ((withoutMemoryMae - withMemoryMae) / withoutMemoryMae) * 10_000,
          ) / 100,
    sampleCount: records.length,
    withMemoryMae: Math.round(withMemoryMae * 100) / 100,
    withoutMemoryMae: Math.round(withoutMemoryMae * 100) / 100,
  };
}
