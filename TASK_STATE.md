# Current Phase

Phase 2 — Persistent Heartbeat and Realtime Dashboard

# Status

complete

# Completed Work

- Phases 0 and 1 are committed.
- Added source scheduling, persistent heartbeat orchestration, agent health, graceful shutdown, and stale-job startup recovery.
- Added Supabase-backed runtime persistence and deterministic in-memory test repositories.
- Added Realtime event, incident, timeline, alert, security, source-health, and agent-health subscriptions with reconnect backoff.
- Added analyzing-state map markers, health metrics, and a streaming agent timeline.

# Verification

- `pnpm install` — passed after adding dotenv.
- `pnpm format:check` — passed.
- `pnpm lint` — passed with zero warnings.
- `pnpm typecheck` — passed for all applications and packages.
- `pnpm test` — passed: 3 files, 8 tests including scheduling, startup recovery, degraded health, and unchanged-event behavior.
- `pnpm build` — passed for the worker and Next.js app.
- `pnpm --filter @pulse-atx/agent start -- --once` — passed; one heartbeat completed and shut down safely.
- Built `/dashboard` smoke test — HTTP 200 with the operations map and agent timeline.
- Live Supabase Realtime integration cannot be exercised without the missing Supabase URL and keys; the compiled subscription and reconnect path is active when configured.

# Missing Configuration

- Supabase URL and keys are unavailable.
- Docker Desktop must be started and `pnpm dlx supabase@2.58.5 db reset` run to apply the migration locally.

# Known Issues

- The checked-in database types are generated-compatible and documented, but cannot be regenerated until a Supabase stack is available.

# Next Phase

- Phase 3 — vLLM and Nemotron Analysis
