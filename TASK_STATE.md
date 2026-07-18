# Current Phase

Phase 9 — Final Hardening

# Status

in_progress

# Completed Work

- Phases 0 through 7 are committed.
- Completed Phase 8 threshold-based alert drafts, high-severity approval requirements, guarded approval RPC, deterministic scenario RPC, and a secret-protected persistent-worker control plane.
- Kept Next.js presentation-only; service-role writes stay in the agent worker.
- Added `/security` with findings, OpenShell violations, approval queue, and all four protected demo controls.
- Polished the live map with selectable severity markers and incident details.
- Expanded `/learning` with first/recent MAE, error history, retrieval usage, completed outcomes, lessons, and before/after memory predictions.

# Verification

- `pnpm --filter @pulse-atx/agent test -- control-server.test.ts migration-contract.test.ts` — passed: 2 files, 12 tests.
- `pnpm typecheck` — passed for all applications and packages.
- `pnpm lint` — passed with zero warnings.
- `pnpm test` — passed: 9 files, 38 tests.
- `pnpm build` — passed for the worker and Next.js application, including `/security`.
- Production server smoke — `/dashboard`, `/learning`, and `/security` each returned HTTP 200.
- `pnpm --filter @pulse-atx/agent start -- --once` — passed in credential-free demo mode.

# Missing Configuration

- Supabase URL and keys are unavailable, and Docker Desktop is stopped, so Phase 8 SQL could not be applied to a live database here.
- vLLM/Nemotron, embedding, and HiddenLayer services remain unavailable; mocked contract tests cover their integrations.
- NemoClaw and OpenShell CLIs remain unavailable; live containment is documented and implemented but not executable on this host.

# Known Issues

- The control server defaults to loopback HTTP for local development. A deployed sandbox must expose it through an authenticated TLS reverse proxy or approved OpenShell forward and set an exact dashboard origin.
- Database types cannot be regenerated until a Supabase stack is available.

# Next Phase

- Phase 9 — Final Hardening
