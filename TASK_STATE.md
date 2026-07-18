# Current Phase

Phase 7 — NemoClaw and OpenShell

# Status

in_progress

# Completed Work

- Phases 0 through 5 are committed.
- Completed Phase 6 NOAA GeoJSON and CapMetro GTFS-Realtime service-alert adapters with stable source identifiers, conditional requests, source health, and official-shape fixtures.
- Added deterministic transit anomaly derivation and temporal, Haversine, route, and location-token correlation.
- Added an atomic cross-feed RPC that attaches supporting events, escalates severity or duration, completes the job, and avoids a second incident/model call.
- Wired both public feeds into the persistent worker with NWS-safe and CapMetro-safe polling intervals.

# Verification

- `pnpm --filter @pulse-atx/agent test -- cross-feed.test.ts migration-contract.test.ts` — passed: 2 files, 10 tests.
- `pnpm typecheck` — passed for all applications and packages.
- `pnpm lint` — passed with zero warnings.
- `pnpm test` — passed: 7 files, 28 tests.
- `pnpm build` — passed for the worker and Next.js application.
- Placeholder audit — no production TODO, placeholder ID, invented row ID, or unimplemented path found.

# Missing Configuration

- Supabase URL and keys are unavailable.
- Docker Desktop must be started and `pnpm dlx supabase@2.58.5 db reset` run to apply migrations locally.
- A running vLLM endpoint, optional API key, and served Nemotron model are unavailable; mocked inference tests cover the integration.
- An OpenAI-compatible embedding endpoint is unavailable; mocked embedding tests cover the integration.
- HiddenLayer API credentials are unavailable; mocked responses cover the official interaction contract.

# Known Issues

- Database types cannot be regenerated from a live Supabase stack until Docker is available.
- CapMetro and NOAA live availability cannot be guaranteed by the application; retries, timeouts, conditional requests, and source-health degradation handle upstream failure.

# Next Phase

- Phase 7 — NemoClaw and OpenShell
