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
