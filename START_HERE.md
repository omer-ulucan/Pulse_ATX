# PulseATX: Start Here

This guide explains what to do next, which credentials are required, how to configure `.env`, how to start each process, and how to verify the complete system.

## Choose a Run Mode

PulseATX has three useful local run modes. Pick the one that matches the services available to you.

| Mode                         | What Works                                                                                                       | Credentials Needed                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Credential-free verification | Install, formatting, types, lint, tests, builds, one-shot heartbeat, fixture evaluation, policy validation       | None                                                                      |
| Local database and dashboard | Supabase schema, seed, Realtime dashboard pages, database inspection                                             | Local Supabase keys printed by the CLI; no cloud account required         |
| Complete live worker         | Public feed ingestion, HiddenLayer scans, Nemotron reasoning, embeddings, pgvector learning, controls, approvals | Supabase, vLLM/Nemotron endpoint, embedding endpoint, HiddenLayer API key |

NemoClaw and OpenShell are not required for ordinary local development. They are required for the production containment boundary and the live containment proof.

## Recommended Next Step

Start with credential-free verification, then start local Supabase and the dashboard. Configure model and security services only after the repository and database are confirmed healthy.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node apps/agent/dist/index.js --once
```

Expected result:

- Formatting, TypeScript, ESLint, and all tests pass.
- The Next.js application builds `/dashboard`, `/learning`, `/live`, and `/security`.
- The worker logs one boot event and one heartbeat, then exits successfully.

## Prerequisites

Install these before starting:

- Node.js 22 or newer.
- Corepack and pnpm 10.33.2.
- Docker Desktop with the Linux container engine running.
- Git.
- For the full worker: access to vLLM/Nemotron, a 384-dimensional embedding service, and HiddenLayer.
- For contained production execution: NemoClaw and OpenShell.

Check the local tools from PowerShell:

```powershell
node --version
corepack pnpm --version
docker version
git --version
```

If `docker version` prints only client information or reports a missing Docker Desktop Linux pipe, start Docker Desktop and wait until its engine is healthy.

## Install the Workspace

From the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

`.env` is ignored by Git. Never commit it.

## Start Local Supabase

Local Supabase supplies Postgres, pgvector, Realtime, PostgREST, Studio, authentication, and the local API gateway.

```powershell
pnpm dlx supabase@2.58.5 start
pnpm dlx supabase@2.58.5 db reset
pnpm dlx supabase@2.58.5 status -o env
```

`db reset` applies every migration and runs `supabase/seed.sql`. Run it whenever you need a clean local database. It deletes only the local Supabase development database.

The status command prints these values:

| Supabase CLI Output | PulseATX `.env` Variable                                 | Secret?                   |
| ------------------- | -------------------------------------------------------- | ------------------------- |
| `API_URL`           | `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`            | No                        |
| `ANON_KEY`          | `NEXT_PUBLIC_SUPABASE_ANON_KEY`                          | Browser-safe, RLS-limited |
| `SERVICE_ROLE_KEY`  | `SUPABASE_SERVICE_ROLE_KEY`                              | Yes, server-only          |
| `STUDIO_URL`        | No application variable; open it to inspect the database | No                        |

For the checked-in local configuration, both Supabase URL variables use `http://127.0.0.1:54321`. Copy the current keys from your own `status -o env` output; do not copy keys from screenshots, logs, or another machine.

## Configure `.env`

The repository already provides safe URLs and defaults in `.env.example`. Fill the blank credential values in `.env`.

### Local Database and Dashboard Only

Set the two keys printed by the local Supabase CLI:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_AGENT_CONTROL_URL=http://127.0.0.1:8787

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=

DEMO_MODE=true
CONTROL_SERVER_ENABLED=false
```

Use this mode when you want to inspect the seeded database and UI without calling external model or security services. In this mode the worker runs an in-memory heartbeat smoke; it does not claim Supabase jobs or pretend that model analysis occurred.

### Complete Live Worker

For real ingestion and analysis, set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_AGENT_CONTROL_URL=http://127.0.0.1:8787

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=

VLLM_BASE_URL=http://127.0.0.1:8000/v1
VLLM_API_KEY=
NEMOTRON_MODEL=nemotron-3-nano

EMBEDDING_BASE_URL=http://127.0.0.1:8001/v1
EMBEDDING_API_KEY=
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5

HIDDENLAYER_API_KEY=
HIDDENLAYER_BASE_URL=https://api.hiddenlayer.ai

DEMO_MODE=false
CONTROL_SERVER_ENABLED=true
CONTROL_SERVER_HOST=127.0.0.1
CONTROL_SERVER_PORT=8787
CONTROL_ALLOWED_ORIGIN=http://localhost:3000
DEMO_SECRET=
DEMO_OPERATOR=Austin Emergency Operations Center
```

Blank values in this example must be filled when the corresponding provider requires them. `SUPABASE_SERVICE_ROLE_KEY`, `HIDDENLAYER_API_KEY`, and `DEMO_SECRET` are always secrets.

Generate `DEMO_SECRET` locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Copy the printed value into `DEMO_SECRET`. The control server rejects secrets shorter than 32 characters.

## Credentials You Need

### 1. Supabase

For local development, no Supabase account is required. Use the values printed by:

```powershell
pnpm dlx supabase@2.58.5 status -o env
```

For a hosted Supabase project, obtain these from the project API settings:

- Project URL for `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`.
- Publishable or anonymous key for `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Secret or service-role key for `SUPABASE_SERVICE_ROLE_KEY`.

Never put the service-role key in a `NEXT_PUBLIC_` variable. It bypasses RLS and belongs only in the worker environment.

### 2. vLLM and Nemotron

PulseATX does not call a hosted chatbot API directly. It expects an OpenAI-compatible vLLM endpoint that serves the configured Nemotron model.

The worker uses the official OpenAI SDK with `VLLM_BASE_URL` as its `baseURL`. One shared client handles incident analysis and completed-incident lesson extraction. When vLLM returns a separate `reasoning_content` field or a tagged `<think>`/`<analysis>` prefix, PulseATX discards that private trace and passes only the final JSON through security scanning and Zod validation.

Required:

- `VLLM_BASE_URL`: the endpoint ending in `/v1`.
- `NEMOTRON_MODEL`: the exact model name exposed by that server.

Optional:

- `VLLM_API_KEY`: required only if your vLLM server or gateway enforces bearer authentication.

If you self-host vLLM without authentication, leave `VLLM_API_KEY` empty. Model download credentials, GPU configuration, and registry access belong to the vLLM host; they are not PulseATX environment variables.

### 3. Embedding Service

PulseATX expects an OpenAI-compatible embeddings endpoint and validates that every embedding contains exactly 384 numbers.

Required:

- `EMBEDDING_BASE_URL`: the service `/v1` URL.
- `EMBEDDING_MODEL`: a model exposed by that endpoint that returns 384-dimensional vectors.

Optional:

- `EMBEDDING_API_KEY`: required only if the endpoint enforces bearer authentication.

The default model name is `BAAI/bge-small-en-v1.5`. If you replace it, the replacement must still produce 384-dimensional vectors unless you also change the database vector dimension and application validation.

### 4. HiddenLayer

The live worker requires HiddenLayer Runtime Security before and after model execution.

Required:

- `HIDDENLAYER_API_KEY`: your Runtime Security API credential.
- `HIDDENLAYER_BASE_URL`: normally `https://api.hiddenlayer.ai`.

Without this key, use `DEMO_MODE=true` for local smoke tests. Do not put a fake key into a live configuration; the worker will start but security calls will fail and jobs will be retried or marked failed.

### 5. Demo Control Secret

`DEMO_SECRET` is generated by you, not issued by an external provider. It protects scenario creation and alert approval endpoints.

It is required only when `CONTROL_SERVER_ENABLED=true`. Keep it out of browser storage, source control, screenshots, and shared logs. The `/security` UI holds it only in component memory and sends it as a bearer token.

### 6. Public Austin, CapMetro, and NOAA Feeds

The default public feeds require no API keys:

- Austin traffic: `AUSTIN_TRAFFIC_FEED_URL`.
- CapMetro service alerts: `CAPMETRO_FEED_URL`.
- NOAA active Texas alerts: `NOAA_ALERTS_URL`.

Keep the checked-in URLs unless you intentionally deploy regional proxies or mirrors.

### 7. NemoClaw and OpenShell

These tools provide the production worker lifecycle and hard containment boundary. They are not needed to render the UI or run tests.

Required for live containment:

- Installed and authenticated `nemoclaw` CLI.
- Installed and configured `openshell` CLI/runtime.
- A sandbox named by `NEMOCLAW_SANDBOX_NAME`, default `pulse-atx`.
- Provider credentials injected by OpenShell or the host rather than written into the sandbox workspace.

`OPENSHELL_LIVE_CONTAINMENT=true` enables the real allow/deny demonstration. When it is `false`, `pnpm demo:containment` validates the checked-in policy without claiming that an operating-system boundary was exercised.

## Environment Variable Rules

### Required When `DEMO_MODE=false`

The worker refuses to start unless all of these are present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VLLM_BASE_URL`
- `NEMOTRON_MODEL`
- `HIDDENLAYER_API_KEY`
- `HIDDENLAYER_BASE_URL`
- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`

### Required for the Browser Dashboard

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Without them, the UI still renders but reports that Supabase is not configured and shows no live rows.

### Required for Demo Controls

- `NEXT_PUBLIC_AGENT_CONTROL_URL`
- `CONTROL_SERVER_ENABLED=true`
- `CONTROL_ALLOWED_ORIGIN` matching the dashboard origin exactly.
- `DEMO_SECRET` with at least 32 characters.
- `DEMO_OPERATOR` for the scripted approval identity.
- `INCIDENT_COMMANDER_DEMO_AUTO_APPROVE=false` when the mission replay should wait for the dashboard approval button.

### Optional Authentication Variables

- `VLLM_API_KEY`
- `EMBEDDING_API_KEY`

Leave these empty only when the corresponding endpoint genuinely allows the worker to connect without a key.

### Safe Defaults

The poll intervals, heartbeat interval, stale-job threshold, mission claim/concurrency/lease/lifetime/execution bounds, log level, worker ID, control host/port, public feed URLs, model names, and containment flags already have usable defaults in `.env.example`.

## Start the Project

### Option A: Credential-Free Smoke

```powershell
pnpm build
node apps/agent/dist/index.js --once
pnpm demo:containment
pnpm evaluate:learning
```

This verifies code and deterministic fixtures but does not run live ingestion or external model calls.

### Option B: Local Supabase and Dashboard

Start Supabase:

```powershell
pnpm dlx supabase@2.58.5 start
pnpm dlx supabase@2.58.5 db reset
```

After filling the local Supabase values in `.env`, start the web application:

```powershell
pnpm dev:web
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/dashboard`
- `http://localhost:3000/learning`
- `http://localhost:3000/security`
- `http://127.0.0.1:54323` for Supabase Studio

### Option C: Complete Live Application

Use three PowerShell terminals.

Terminal 1 — persistent worker:

```powershell
pnpm dev:agent
```

Terminal 2 — frontend:

```powershell
pnpm dev:web
```

Terminal 3 — verification and scenarios:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health
Invoke-WebRequest -UseBasicParsing http://localhost:3000/dashboard
pnpm demo:scenarios
```

The worker should log heartbeats every five seconds. The dashboard should show source health, events, incidents, decisions, security findings, and timeline changes through Supabase Realtime.

## Run the Complete Demo

With the full live configuration running:

```powershell
pnpm demo:scenarios
pnpm demo:incident-commander
pnpm demo:containment
pnpm demo:replay
pnpm evaluate:learning
```

Expected scenario results:

1. Benign traffic produces an idempotent event/job.
2. Cross-feed evidence escalates one incident without duplication.
3. Recursive memory stores a resolved outcome and pgvector lesson.
4. Prompt-injection content enters the security quarantine path.
5. Exfiltration produces a runtime-policy finding.
6. A critical alert waits for approval and is approved with `DEMO_OPERATOR`.
7. The Incident Commander executes the North Lamar `24 → 43 → 40` minute closed-loop mission and stores its final lesson.

Open `/security` to inspect findings and approvals, `/learning` to inspect memory effects, and `/dashboard` for the incident timeline.

The deterministic Incident Commander command owns its mission loop and should run without a second worker claiming the same staged mission. For dashboard approval, set `INCIDENT_COMMANDER_DEMO_AUTO_APPROVE=false`; the command starts the bounded control endpoint and waits up to five minutes. See [`docs/INCIDENT_COMMANDER.md`](docs/INCIDENT_COMMANDER.md) for the exact setup and troubleshooting flow.

## Start with Docker Compose

Build both production images:

```powershell
docker compose build
```

Run only the dashboard image:

```powershell
docker compose up web
```

Run the local live-integration worker profile and dashboard:

```powershell
docker compose --profile live up agent web
```

The Compose worker connects to host services through `host.docker.internal`. Override these only when your endpoints are elsewhere:

- `CONTAINER_SUPABASE_URL`
- `CONTAINER_VLLM_BASE_URL`
- `CONTAINER_EMBEDDING_BASE_URL`

Docker Compose is a local deployment convenience. It does not replace NemoClaw/OpenShell containment.

## Production Worker Boundary

Build the worker and run it through the checked-in containment policy:

```powershell
pnpm --filter @pulse-atx/agent build
nemoclaw pulse-atx policy-add --from-file policies/nemoclaw-pulse-atx.yaml --yes
nemoclaw pulse-atx exec --workdir /sandbox/workspace -- node apps/agent/dist/index.js
```

The production environment must inject secrets outside `/sandbox/workspace`. Do not copy `.env` into a distributable image or shared sandbox workspace.

## Verify Each Dependency

### Supabase

```powershell
pnpm dlx supabase@2.58.5 status
```

Then open Studio at `http://127.0.0.1:54323` and confirm `raw_events`, `event_jobs`, `incidents`, `incident_memories`, `security_findings`, and `agent_health` exist.

### Worker Control Server

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health
```

Expected JSON: `{"status":"ok"}`.

### Dashboard

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/dashboard
Invoke-WebRequest -UseBasicParsing http://localhost:3000/learning
Invoke-WebRequest -UseBasicParsing http://localhost:3000/security
```

Each request should return HTTP 200.

### Repository Quality Gate

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Common Problems

### Docker Engine Is Not Running

Symptom: the Supabase CLI reports a missing Docker Desktop Linux engine pipe.

Fix: start Docker Desktop, wait for it to report that the engine is running, then retry `pnpm dlx supabase@2.58.5 start`.

### Port Already in Use

Default ports:

- Web: `3000`
- vLLM: `8000`
- Embeddings: `8001`
- Control server: `8787`
- Supabase API: `54321`
- Supabase database: `54322`
- Supabase Studio: `54323`

Stop the conflicting process or change the configurable service port and matching URL. Supabase ports are defined in `supabase/config.toml`.

### Worker Reports an Invalid Environment

Read the reported variable name. When `DEMO_MODE=false`, all eight live-worker values listed above are mandatory. When `CONTROL_SERVER_ENABLED=true`, `DEMO_SECRET` must contain at least 32 characters.

### Dashboard Renders but Shows No Data

Confirm:

1. Local Supabase is running.
2. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.
3. You restarted `pnpm dev:web` after changing `.env`.
4. `pnpm dlx supabase@2.58.5 db reset` completed successfully.

### Scenario Script Cannot Connect

Confirm:

1. `CONTROL_SERVER_ENABLED=true`.
2. The live worker is running with `DEMO_MODE=false`.
3. `NEXT_PUBLIC_AGENT_CONTROL_URL=http://127.0.0.1:8787`.
4. The same `DEMO_SECRET` is visible to the worker and scenario script.
5. The `/health` request succeeds.

### Model or Embedding Calls Fail

Confirm the configured base URL ends in `/v1`, the model name exactly matches the server, bearer authentication matches the endpoint, and the embedding response contains 384 numbers.

### HiddenLayer Calls Fail

Confirm `HIDDENLAYER_API_KEY` is a valid Runtime Security credential and `HIDDENLAYER_BASE_URL` is the API origin, not a console page URL.

## Stop and Restart

Stop the Next.js and worker terminals with `Ctrl+C`. Both processes handle graceful shutdown.

Stop local Supabase:

```powershell
pnpm dlx supabase@2.58.5 stop
```

Reset and restart the local database later:

```powershell
pnpm dlx supabase@2.58.5 start
pnpm dlx supabase@2.58.5 db reset
```

## Security Checklist

- Keep `.env` untracked.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `HIDDENLAYER_API_KEY`, model keys, embedding keys, or `DEMO_SECRET` through `NEXT_PUBLIC_` variables.
- Use an exact `CONTROL_ALLOWED_ORIGIN`.
- Keep the control server on loopback unless it is behind authenticated TLS and an approved OpenShell route.
- Do not treat Docker as a containment boundary.
- Inject production secrets through the host or OpenShell provider configuration.
- Rotate any credential that appears in a commit, screenshot, terminal recording, or shared log.

## Final Startup Checklist

- [ ] Node, pnpm, Docker, and Git are installed.
- [ ] `pnpm install --frozen-lockfile` passes.
- [ ] `.env` exists and is not tracked.
- [ ] Local or hosted Supabase variables are set.
- [ ] `pnpm dlx supabase@2.58.5 db reset` passes.
- [ ] vLLM serves the configured Nemotron model for live mode.
- [ ] The embedding endpoint returns 384-dimensional vectors for live mode.
- [ ] HiddenLayer credentials are set for live mode.
- [ ] `DEMO_SECRET` is generated if controls are enabled.
- [ ] The worker `/health` endpoint returns HTTP 200.
- [ ] `/dashboard`, `/learning`, and `/security` return HTTP 200.
- [ ] `pnpm demo:scenarios` completes all six scenarios.
- [ ] NemoClaw/OpenShell is used for the production worker boundary.
