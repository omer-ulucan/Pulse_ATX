# Autonomous Incident Commander

## What It Proves

The Autonomous Incident Commander is the persistent closed-loop response layer in PulseATX. A qualifying incident becomes a durable mission in Supabase; the worker creates a bounded Nemotron plan, executes only registered tools, pauses at policy and operator boundaries, schedules another observation, revises the persisted plan from fresh traffic/transit/weather evidence, and stores the completed outcome as pgvector memory.

The lifecycle is:

```text
OBSERVE → PLAN → ACT → WAIT → RE-OBSERVE → REVISE → COMPLETE OR CONTINUE
```

This is not a browser chatbot. Next.js reads state and sends authenticated approval decisions; the TypeScript worker and Supabase own mission execution.

## Prerequisites

- Node.js 22 or newer
- pnpm 10.33.2
- Docker Desktop with the Linux engine running for local Supabase
- Repository dependencies installed with `pnpm install --frozen-lockfile`
- A root `.env` copied from `.env.example`

The root `.env` is ignored by Git. Never add the service-role key, vLLM bearer token, embedding key, HiddenLayer key, or control secret to a `NEXT_PUBLIC_` variable.

## Minimum Variables for the Deterministic Demo

The deterministic replay uses real Supabase tables, RPCs, RLS-visible records, Realtime, mission repositories, the mission state machine, the typed tool registry, the approval gate, and the memory pipeline. Its Nemotron and HiddenLayer responses are deterministic fixtures so the judging story cannot drift with an external provider.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key printed by Supabase>
NEXT_PUBLIC_AGENT_CONTROL_URL=http://127.0.0.1:8787

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local service-role key printed by Supabase>

DEMO_OPERATOR=Austin Emergency Operations Center
INCIDENT_COMMANDER_DEMO_AUTO_APPROVE=true
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. The dashboard needs only the anonymous key protected by the checked-in read policies.

## Apply the Database

From the repository root:

```bash
pnpm dlx supabase@2.58.5 start
pnpm dlx supabase@2.58.5 db reset
```

`db reset` applies the mission data model, atomic runtime functions, meaningful-update wake trigger, four-stage replay RPC, and external-resolution cancellation trigger.

## Run the Complete Unattended Demo

Start the dashboard in one terminal:

```bash
pnpm dev:web
```

Open `http://localhost:3000/dashboard`. In a second terminal run:

```bash
pnpm demo:incident-commander
```

Do not run a second live worker during this deterministic command. The command owns one bounded mission coordinator so another worker cannot claim the same staged mission between steps.

The command performs and validates:

1. North Lamar lane-blocking collision, Route 801 five-minute delay, and heavy rain.
2. Mission creation with severity `3` and a `24`-minute duration prediction.
3. Similar-incident retrieval, transit check, weather check, targeted draft, and a 60-second scheduled recheck.
4. A meaningful live update that immediately advances the wake: two blocked lanes, Route 801 delay `14`, severity `5`, prediction `43`.
5. Alert revision, counterfactual audit, and a protected simulated-publication pause.
6. Operator approval, same-mission resume, and one idempotent simulated publication.
7. Reopened lanes, two-minute delay, weakening rain, severity de-escalation to `2`, and cancellation of obsolete escalation work.
8. A final recovery observation, incident closure, observed duration `40`, prediction error `3`, successful outcome, and a reusable mission lesson.

Every stage is nonce-idempotent. Tool execution fingerprints prevent duplicate writes if a wake or result is delivered again.

## Use the Dashboard Approval Button

For a human-in-the-loop judging run, generate a control secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set:

```dotenv
DEMO_SECRET=<generated value>
INCIDENT_COMMANDER_DEMO_AUTO_APPROVE=false
CONTROL_SERVER_HOST=127.0.0.1
CONTROL_SERVER_PORT=8787
CONTROL_ALLOWED_ORIGIN=http://localhost:3000
NEXT_PUBLIC_AGENT_CONTROL_URL=http://127.0.0.1:8787
```

Restart `pnpm dev:web` after changing a `NEXT_PUBLIC_` variable, then run:

```bash
pnpm demo:incident-commander
```

The command starts the bounded control endpoint, reaches `waiting_approval`, and waits up to five minutes. In the Incident Commander approval card, enter the same `DEMO_SECRET`, enter an operator identity, and select **Approve**. The database decision resumes the same mission; no process restart or database edit is required. Rejecting ends the command safely without publishing.

## Live Worker Credentials

The persistent production path uses real provider adapters rather than the deterministic replay fixtures. Set `DEMO_MODE=false` and provide:

| Variable                    | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `SUPABASE_URL`              | Server-side Supabase project URL             |
| `SUPABASE_SERVICE_ROLE_KEY` | Mission/tool/outcome writes and atomic RPCs  |
| `VLLM_BASE_URL`             | OpenAI-compatible vLLM `/v1` endpoint        |
| `VLLM_API_KEY`              | vLLM bearer token when required              |
| `NEMOTRON_MODEL`            | Served model name, such as `nemotron-3-nano` |
| `HIDDENLAYER_BASE_URL`      | HiddenLayer API origin                       |
| `HIDDENLAYER_CLIENT_ID`     | HiddenLayer OAuth client identifier          |
| `HIDDENLAYER_CLIENT_SECRET` | Pre/post-model and tool scan credential      |
| `EMBEDDING_BASE_URL`        | OpenAI-compatible embeddings `/v1` endpoint  |
| `EMBEDDING_API_KEY`         | Embedding bearer token when required         |
| `EMBEDDING_MODEL`           | Model that returns exactly 384 dimensions    |

The supplied self-hosted Nemotron server belongs in `VLLM_BASE_URL`, `VLLM_API_KEY`, and `NEMOTRON_MODEL`; the key must remain only in ignored/runtime environment configuration.

Then run:

```bash
pnpm dev:agent
pnpm dev:web
```

The live worker polls Austin Open Data traffic, CapMetro, and NOAA when their feed URLs are configured. Nemotron planning output is repaired once if invalid and otherwise falls back to a deterministic safe plan. HiddenLayer blocks explicit threats; ambiguous tool scans require operator review. OpenShell/NemoClaw remain the outer runtime boundary.

## Mission Bounds

All bounds are validated at startup:

| Variable                               |    Default |          Allowed |
| -------------------------------------- | ---------: | ---------------: |
| `MISSION_CLAIM_LIMIT`                  |        `4` |           `1–12` |
| `MISSION_CONCURRENCY`                  |        `2` |            `1–4` |
| `MISSION_LEASE_SECONDS`                |       `60` |         `15–300` |
| `MISSION_MAX_LIFETIME_MS`              | `14400000` | `60000–86400000` |
| `MISSION_MAX_TOOL_EXECUTIONS_PER_WAKE` |       `12` |           `1–12` |

Plans contain at most eight steps, a mission may create at most three revisions after its initial plan, and one wake may execute at most twelve tools. Mission-cycle failures retry twice by default and then enter `failed` rather than looping indefinitely.

## Persistence and Recovery

- A partial unique index permits at most one planning/active/waiting mission per incident.
- `SKIP LOCKED` claims and bounded leases prevent concurrent workers from running the same mission.
- An expired lease makes an interrupted `planning` or `active` mission claimable after worker restart.
- Tool fingerprints replay completed results instead of executing the same action twice.
- Observation fingerprints prevent duplicate state writes.
- Approval decisions are compare-and-set and idempotent.
- If an incident resolves before a pending protected action executes, the mission, current steps, and approval are cancelled atomically.
- `SIGINT` and `SIGTERM` stop the heartbeat and control listener cleanly.

## Troubleshooting

### Demo RPC Is Missing

Run `pnpm dlx supabase@2.58.5 db reset`. The command requires migrations through `202607190004_incident_commander_hardening.sql`.

### Docker Pipe Is Missing on Windows

Start Docker Desktop and wait for the Linux engine to report healthy, then rerun `supabase start` and `db reset`.

### Dashboard Does Not Update

Confirm the browser URL and anonymous key point to the same Supabase project as the server URL and service-role key. Restart the web process after changing either `NEXT_PUBLIC_` value. Verify Realtime is enabled for all four `agent_*` mission tables.

### Approval Control Fails

Use the exact `DEMO_SECRET` in the dashboard, keep `CONTROL_ALLOWED_ORIGIN` equal to the browser origin, and ensure port `8787` is free. Manual mode starts its own temporary control server; do not also start `pnpm dev:agent` on that port.

### Live Model or Security Provider Is Unavailable

The live worker reports degraded health and uses bounded repair/fallback behavior; it never substitutes provider credentials into the browser. The deterministic command remains available for a reproducible lifecycle demonstration.

## Known Demo Limitation

`publish_simulated_alert` writes only the internal dashboard simulation status. PulseATX does not send automatic real-world mass notifications. The deterministic demo fixtures prove orchestration and policy behavior, while live provider quality and availability remain external dependencies.
