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

For a live database and complete scenario run, follow [`docs/SETUP.md`](docs/SETUP.md) and [`docs/DEMO.md`](docs/DEMO.md). The full variable inventory is in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md), and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) diagrams the trust and data boundaries.

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

## Recursive incident memory

Set `EMBEDDING_BASE_URL` to an OpenAI-compatible embeddings endpoint serving `EMBEDDING_MODEL`. Resolved incidents are recorded through an idempotent outcome RPC, converted into 384-dimensional pgvector memories, and retrieved before Nemotron predicts a similar event. Open `/learning` to inspect stored lessons and observed prediction error.

The production adapter uses Austin's public traffic endpoint and rejects any row without a stable source identifier rather than inventing an ID. Tests use checked-in feed snapshots and mocked model/security endpoints for reproducibility; evaluation labels are explicit deterministic fixtures, not silently substituted live observations.

```bash
pnpm demo:replay
pnpm evaluate:learning
```

## Cross-feed intelligence

The worker polls the [NWS active-alerts API](https://www.weather.gov/documentation/services-web-api) no more than once per minute and the [CapMetro GTFS-Realtime service-alert dataset](https://www.capmetro.org/developertools) every 30 seconds. NOAA GeoJSON polygons provide deterministic spatial evidence; CapMetro effects derive bounded delay and severity anomalies.

Before model execution, supporting events are compared with active incidents using a two-hour time window, Haversine distance, affected routes, and location terms. A qualifying event is attached through one atomic RPC that escalates severity or duration and completes the job without creating another incident.

## NemoClaw and OpenShell containment

`policies/openshell.yaml` is a complete OpenShell v1 policy with deny-by-default egress, per-binary REST rules, a non-root process, and hard-requirement Landlock filesystem controls. Only the workspace, runtime state, temporary storage, and `/dev/null` are writable; NemoClaw/OpenShell config and provider credential paths remain outside the worker's accessible tree.

For a NemoClaw-managed sandbox, onboard a sandbox named `pulse-atx`, copy the built workspace to `/sandbox/workspace`, and apply the checked-in custom preset:

```bash
nemoclaw pulse-atx policy-add --from-file policies/nemoclaw-pulse-atx.yaml --yes
nemoclaw pulse-atx exec --workdir /sandbox/workspace -- node apps/agent/dist/index.js
```

Use NemoClaw's managed `inference.local` route for vLLM inside that sandbox. The custom preset adds only PulseATX feeds, Supabase, HiddenLayer, and the local embedding bridge; it does not add catch-all egress. Keep credentials in OpenShell providers or host-managed environment injection, never in the sandbox workspace.

Run the deterministic policy check on any machine:

```bash
pnpm demo:containment
```

With a running sandbox and Supabase migrations applied, set `OPENSHELL_LIVE_CONTAINMENT=true`. The same command executes one approved NOAA request and one forbidden `example.com` request through `nemoclaw exec`; it requires the forbidden request to fail and records the denial through `record_runtime_policy_violation`. The existing Realtime security panel displays that `runtime_policy` finding. Stream gateway evidence with `openshell logs pulse-atx --tail`.

The enforcement boundaries are distinct: HiddenLayer detects malicious content before and after inference, OpenShell blocks filesystem/network operations outside policy even if the process is compromised, and the human-approval workflow controls legitimate but high-impact actions.

## Alerts, approvals, and demo controls

Validated decisions create operator alert drafts only when severity is at least 3, confidence is at least 0.65, and duration or severity crosses a meaningful threshold. Severity 4–5 alerts and model-requested escalations become `pending_approval`; PulseATX never mass-publishes them automatically. `/security` shows detections, OpenShell blocks, the approval queue, and all protected scenarios.

Next.js remains presentation-only. Mutating controls call the persistent worker's bounded HTTP control plane, which uses the service-role key server-side. Generate a secret rather than checking one in:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set that output as `DEMO_SECRET`, set `CONTROL_SERVER_ENABLED=true`, restrict `CONTROL_ALLOWED_ORIGIN` to the dashboard origin, and set the browser-safe `NEXT_PUBLIC_AGENT_CONTROL_URL`. Then start the worker and web app and open `/security`. The secret stays only in component memory and is sent as a bearer token; it is never stored in browser storage.

The protected controls create six deterministic flows without database editing: benign traffic, cross-feed escalation, recursive memory, prompt injection, an exfiltration-policy finding, and a critical alert awaiting approval. Scenario writes are nonce-idempotent, and operator approval uses a guarded transaction that records identity, time, and an agent timeline event.

Run all six controls and approve the critical alert from one validated script:

```bash
pnpm demo:scenarios
```

## Production artifacts

`pnpm build` emits a bundled Node.js worker at `apps/agent/dist/index.js` and a standalone-capable Next.js build. `docker-compose.yml` builds both images; the worker is behind the explicit `live` profile because Docker alone does not satisfy the OpenShell containment boundary.

```bash
docker compose build
docker compose up web
docker compose --profile live up agent web
```
