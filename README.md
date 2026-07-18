# PulseATX

PulseATX is a persistent, real-time city intelligence agent for Austin. A TypeScript worker polls public feeds, stores idempotent revisions in Supabase, scans untrusted data, retrieves historical memory, and asks Nemotron through a vLLM-compatible API for structured incident decisions. A Next.js dashboard receives updates through Supabase Realtime.

## Prerequisites

- Node.js 22 or newer
- pnpm 10.33.2
- Docker for the local Supabase stack (introduced in Phase 1)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The dashboard runs at `http://localhost:3000`. The persistent worker runs as a separate process and defaults to safe demo mode when external credentials are absent.

## Workspace

- `apps/web` — frontend-only Next.js dashboard
- `apps/agent` — persistent heartbeat and processing worker
- `packages/schemas` — Zod environment and domain schemas
- `packages/shared` — shared deterministic helpers
- `packages/prompts` — versioned Nemotron prompts
- `packages/database-types` — generated-compatible Supabase types
- `supabase` — local configuration, migrations, and seeds
- `policies` — NemoClaw and OpenShell runtime policies

Copy `.env.example` to `.env`. Keep `SUPABASE_SERVICE_ROLE_KEY`, model keys, embedding keys, and `HIDDENLAYER_API_KEY` server-side only.

## Local Supabase

With Docker Desktop running, apply the checked-in schema and seed through the pinned CLI version:

```bash
pnpm dlx supabase@2.58.5 start
pnpm dlx supabase@2.58.5 db reset
```

The worker uses `public.ingest_raw_event` so the raw event revision and its processing job are created atomically. Repeated fingerprints return the existing revision without creating another job.

## Persistent worker

The heartbeat is a separate TypeScript process; it never runs in Next.js or Vercel:

```bash
pnpm dev:agent
```

On startup it recovers stale Postgres jobs, polls only due sources, persists source and agent health, and shuts down cleanly on `SIGINT` or `SIGTERM`. Open `/dashboard` for the reconnecting Supabase Realtime view.

## Nemotron through vLLM

Set `VLLM_BASE_URL` to an OpenAI-compatible `/v1` endpoint and `NEMOTRON_MODEL` to the served model name. The worker claims at most eight jobs per heartbeat and runs at most four model requests concurrently. Structured responses are Zod-validated, repaired once, and replaced with a persisted deterministic fallback if validation still fails.

## Runtime security

The live worker sends feed input, model prompts, model output, tool arguments, tool results, and generated alert text to HiddenLayer's [`/detection/v1/interactions`](https://docs.hiddenlayer.ai/docs/products/console/runtime_security_interactions) runtime service. Blocking detections atomically quarantine the raw event and job, store a security finding, and prevent downstream execution.

With Supabase configured, inject the deterministic attack scenario with `pnpm demo:malicious`.
