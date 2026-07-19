# Reproducible Setup

For the detailed Windows-first setup, credential acquisition, complete `.env` mapping, startup modes, and troubleshooting, see [`START_HERE.md`](../START_HERE.md).

## Prerequisites

- Node.js 22 or newer
- pnpm 10.33.2 through Corepack
- Docker Desktop with the engine running
- NemoClaw and OpenShell for the production worker boundary
- A vLLM endpoint serving Nemotron, a 384-dimensional embedding endpoint, and HiddenLayer credentials for live analysis

## Install and database

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dlx supabase@2.58.5 start
pnpm dlx supabase@2.58.5 db reset
```

Copy the local Supabase URL, anon key, and service-role key printed by the CLI into `.env`. `db reset` applies all migrations in order and then runs `supabase/seed.sql` through the same idempotent ingestion RPC as the worker.

## Credential-free verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node apps/agent/dist/index.js --once
pnpm demo:containment
pnpm evaluate:learning
```

The one-shot worker intentionally uses `DEMO_MODE=true`; it verifies boot, heartbeat, structured logs, and shutdown without pretending to perform live model or database work.

## Live services

Set every live-worker variable in `docs/ENVIRONMENT.md`, then change `DEMO_MODE=false`, `CONTROL_SERVER_ENABLED=true`, and generate `DEMO_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm dev:agent
pnpm dev:web
```

Open `http://localhost:3000/dashboard`, `/learning`, and `/security`.

For the full autonomous mission replay, configuration, operator-approval mode, and recovery behavior, follow [`INCIDENT_COMMANDER.md`](INCIDENT_COMMANDER.md).

## Containers

Build and run the presentation service:

```bash
docker compose build
docker compose up web
```

The Compose worker is an explicit local live-integration profile and is not a containment boundary:

```bash
docker compose --profile live up agent web
```

For production, build the worker artifact and launch it through NemoClaw/OpenShell instead:

```bash
pnpm --filter @pulse-atx/agent build
nemoclaw pulse-atx policy-add --from-file policies/nemoclaw-pulse-atx.yaml --yes
nemoclaw pulse-atx exec --workdir /sandbox/workspace -- node apps/agent/dist/index.js
```
