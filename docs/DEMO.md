# Complete Demo

## Start

Apply the setup in `docs/SETUP.md`. In `.env`, set live credentials, `DEMO_MODE=false`, `CONTROL_SERVER_ENABLED=true`, a generated `DEMO_SECRET`, `CONTROL_ALLOWED_ORIGIN=http://localhost:3000`, and `NEXT_PUBLIC_AGENT_CONTROL_URL=http://127.0.0.1:8787`.

Use separate terminals:

```bash
pnpm dev:agent
pnpm dev:web
```

Open `/dashboard`, `/learning`, and `/security`, then run:

```bash
pnpm demo:scenarios
```

## Autonomous Incident Commander

The complete closed-loop judging story has its own one-command replay:

```bash
pnpm demo:incident-commander
```

It creates the North Lamar mission, executes the initial plan, advances a scheduled wake with live escalation, pauses at approval, publishes only after approval, observes recovery, de-escalates, closes the incident, records the three-minute prediction error, and stores a mission lesson. Keep `/dashboard` open to watch the Incident Commander panel update through Realtime.

The default is unattended approval for a repeatable stage run. Set `INCIDENT_COMMANDER_DEMO_AUTO_APPROVE=false` to approve from the dashboard. Complete setup and credential details are in [`INCIDENT_COMMANDER.md`](INCIDENT_COMMANDER.md).

## Expected sequence

1. **Benign traffic** creates an idempotent raw event and analysis job.
2. **Cross-feed escalation** links Austin traffic and NOAA evidence to one severity-4 incident without a duplicate incident.
3. **Recursive memory** stores a resolved outcome, a 384-dimensional pgvector lesson, and a decision showing an 18-minute memory adjustment.
4. **Prompt injection** inserts an untrusted feed event for the worker and HiddenLayer quarantine path.
5. **Exfiltration attempt** records a denied OpenShell runtime-policy finding; run `pnpm demo:containment` for policy validation, or set `OPENSHELL_LIVE_CONTAINMENT=true` for a real sandbox denial.
6. **Critical approval** creates a severity-5 pending alert and the script approves it with `DEMO_OPERATOR`, recording identity and time.

The scenario script prints created records and stops immediately on an HTTP, validation, timeout, or missing-alert failure. Every invocation uses unique nonces, while repeated requests with the same nonce are idempotent in Postgres.

## Learning evaluation

```bash
pnpm demo:replay
pnpm evaluate:learning
```

The replay strips labeled outcomes before ingestion. The evaluation uses checked-in labels and reports duration MAE with and without memory; it does not pass the answer labels into the worker.
