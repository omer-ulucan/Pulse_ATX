# PulseATX Architecture

## System boundary

```mermaid
flowchart LR
  Traffic[Austin traffic API] --> Worker
  Transit[CapMetro GTFS-RT] --> Worker
  Weather[NOAA alerts API] --> Worker
  Worker[TypeScript heartbeat worker] --> HiddenLayer[HiddenLayer runtime security]
  Worker --> VLLM[vLLM / Nemotron]
  Worker --> Embeddings[OpenAI-compatible embeddings]
  Worker --> Supabase[(Supabase Postgres + pgvector)]
  Supabase --> Realtime[Supabase Realtime]
  Realtime --> Web[Next.js dashboard]
  Web --> Control[Authenticated worker control API]
  Control --> Worker
  NemoClaw[NemoClaw lifecycle] --> OpenShell[OpenShell sandbox]
  OpenShell --> Worker
```

Next.js and Vercel are presentation-only. The service-role key, feed polling, job claims, model calls, outcome consolidation, scenario mutation, and persistent heartbeat remain in the worker.

## Event lifecycle

```mermaid
sequenceDiagram
  participant Feed as Public feed
  participant Agent as Heartbeat worker
  participant DB as Supabase
  participant HL as HiddenLayer
  participant Model as vLLM/Nemotron
  participant UI as Realtime dashboard
  Agent->>Feed: Conditional bounded poll
  Agent->>DB: ingest_raw_event(payload, SHA-256)
  DB-->>Agent: Event revision + idempotent job
  Agent->>DB: Claim jobs with SKIP LOCKED
  Agent->>HL: Scan feed and prompt
  Agent->>DB: Retrieve pgvector memories
  Agent->>Model: Structured decision request
  Agent->>HL: Scan output and alert text
  Agent->>DB: Atomic incident/decision/job update
  DB-->>UI: Realtime table changes
```

## Reliability and security

- Database uniqueness protects event revisions, jobs, incident memory, outcomes, alerts, and demo runs from duplicate writes.
- The worker claims eight jobs per heartbeat and limits model concurrency to four.
- HTTP clients use timeouts and retries; the control server limits bodies to 16 KiB and enforces request/header timeouts.
- `SIGINT` and `SIGTERM` stop polling, update health, append a timeline event, and close the control server.
- HiddenLayer blocks malicious content; OpenShell enforces deny-by-default network/filesystem policy; operator approval guards high-impact alerts.

## Autonomous mission lifecycle

```mermaid
stateDiagram-v2
  [*] --> planning: qualifying incident
  planning --> active: validated plan persisted
  active --> waiting: bounded recheck scheduled
  active --> waiting_approval: protected tool blocked
  waiting_approval --> active: operator approved
  waiting_approval --> cancelled: operator rejected / incident resolved
  waiting --> active: due wake / meaningful update
  active --> active: immutable plan revision
  active --> completed: close + outcome + lesson
  active --> failed: retry or lifetime budget exhausted
```

Each wake records a correlated incident snapshot and deterministic numeric/category deltas before Nemotron reviews the current plan. Plan versions are append-only. Every proposed tool passes Zod allowlist validation, HiddenLayer argument scanning, local OpenShell policy evaluation, approval enforcement, bounded execution, output validation, and HiddenLayer result scanning. Supabase Realtime streams missions, steps, observations, tool executions, and timeline evidence to the Incident Commander dashboard instrument.
