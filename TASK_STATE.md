# Current Phase

Phase 8 — Alerts, Human Approval, and Demo Controls

# Status

in_progress

# Completed Work

- Phases 0 through 6 are committed.
- Completed Phase 7 OpenShell v1 runtime policy with deny-by-default per-binary egress, method/path restrictions, non-root execution, hard-requirement Landlock, workspace-only writes, and protected configuration paths.
- Added a NemoClaw-compatible `pulse-atx` custom network preset without catch-all hosts.
- Added policy parsing and deterministic validation directly from the checked-in YAML.
- Added a containment demo that can execute approved and forbidden requests through `nemoclaw exec` and persist the denial as an OpenShell `runtime_policy` security finding.
- Added the atomic violation logging RPC; the existing Realtime security dashboard displays these findings.

# Verification

- `pnpm install` — passed after adding the YAML policy parser.
- `pnpm --filter @pulse-atx/agent test -- runtime-policy.test.ts migration-contract.test.ts` — passed: 2 files, 11 tests.
- `pnpm demo:containment` — passed: NOAA endpoint allowed and `example.com` exfiltration destination denied by the parsed policy.
- `pnpm typecheck` — passed for all applications and packages.
- `pnpm lint` — passed with zero warnings.
- `pnpm test` — passed: 8 files, 33 tests.
- `pnpm build` — passed for the worker and Next.js application.

# Missing Configuration

- The `nemoclaw` and `openshell` CLIs are not installed on this host, so `OPENSHELL_LIVE_CONTAINMENT=true pnpm demo:containment` could not exercise the kernel/proxy enforcement layer here.
- Supabase URL and keys are unavailable, so the demo printed the violation but could not persist a dashboard finding.
- Docker Desktop is stopped; migrations cannot be applied locally.
- vLLM/Nemotron, embedding, and HiddenLayer services remain unavailable; mocked contract tests cover their integrations.

# Known Issues

- Policy validation proves the exact allow/deny rules, but only execution inside OpenShell provides the hard boundary; the in-process evaluator is explicitly a credential-free test mode, not a security substitute.
- Database types cannot be regenerated until a Supabase stack is available.

# Next Phase

- Phase 8 — Alerts, Human Approval, and Demo Controls
