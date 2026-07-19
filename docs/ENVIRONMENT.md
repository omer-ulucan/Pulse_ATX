# Environment Checklist

Copy `.env.example` to `.env`. Never prefix a secret with `NEXT_PUBLIC_` and never commit `.env`.

| Variable                               | Required           | Scope                 | Purpose                                                                          |
| -------------------------------------- | ------------------ | --------------------- | -------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Live UI            | Browser-safe          | Supabase API and Realtime URL                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Live UI            | Browser-safe          | RLS-limited anonymous key                                                        |
| `NEXT_PUBLIC_AGENT_CONTROL_URL`        | Demo controls      | Browser-safe          | Persistent worker control API                                                    |
| `SUPABASE_URL`                         | Live worker        | Server secret context | Supabase project URL                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`            | Live worker        | Secret                | Worker-only database access                                                      |
| `VLLM_BASE_URL`                        | Live worker        | Server                | OpenAI-compatible vLLM `/v1` URL                                                 |
| `VLLM_API_KEY`                         | Provider dependent | Secret                | vLLM bearer credential                                                           |
| `NEMOTRON_MODEL`                       | Live worker        | Server                | Served Nemotron model identifier                                                 |
| `EMBEDDING_BASE_URL`                   | Live worker        | Server                | OpenAI-compatible embedding `/v1` URL                                            |
| `EMBEDDING_API_KEY`                    | Provider dependent | Secret                | Embedding bearer credential                                                      |
| `EMBEDDING_MODEL`                      | Live worker        | Server                | 384-dimensional embedding model                                                  |
| `HIDDENLAYER_API_KEY`                  | Live worker        | Secret                | HiddenLayer runtime-security credential                                          |
| `HIDDENLAYER_BASE_URL`                 | Live worker        | Server                | HiddenLayer API origin                                                           |
| `DEMO_MODE`                            | Yes                | Server                | `true` runs credential-free heartbeat smoke only; `false` runs live integrations |
| `DEMO_SECRET`                          | Control server     | Secret                | Bearer secret for scenario and approval endpoints                                |
| `DEMO_OPERATOR`                        | Demo script        | Server                | Identity recorded during approval                                                |
| `CONTROL_SERVER_ENABLED`               | Demo controls      | Server                | Enables the worker control listener                                              |
| `CONTROL_SERVER_HOST`                  | Control server     | Server                | Bind address; use loopback unless proxied safely                                 |
| `CONTROL_SERVER_PORT`                  | Control server     | Server                | Listener port, default `8787`                                                    |
| `CONTROL_ALLOWED_ORIGIN`               | Browser controls   | Server                | Exact allowed dashboard origin                                                   |
| `AUSTIN_TRAFFIC_FEED_URL`              | Live ingestion     | Server                | Austin traffic Socrata endpoint                                                  |
| `CAPMETRO_FEED_URL`                    | Live ingestion     | Server                | CapMetro GTFS-RT service-alert endpoint                                          |
| `NOAA_ALERTS_URL`                      | Live ingestion     | Server                | NOAA active-alert endpoint                                                       |
| `WORKER_ID`                            | Yes                | Server                | Stable job-lock and health identity                                              |
| `LOG_LEVEL`                            | No                 | Server                | Pino log level                                                                   |
| `HEARTBEAT_INTERVAL_MS`                | No                 | Server                | Persistent loop interval                                                         |
| `TRAFFIC_POLL_INTERVAL_MS`             | No                 | Server                | Austin poll interval                                                             |
| `TRANSIT_POLL_INTERVAL_MS`             | No                 | Server                | CapMetro poll interval                                                           |
| `WEATHER_POLL_INTERVAL_MS`             | No                 | Server                | NOAA poll interval                                                               |
| `STALE_JOB_AFTER_MS`                   | No                 | Server                | Startup-recovery age threshold                                                   |
| `MISSION_CLAIM_LIMIT`                  | No                 | Server                | Missions claimed per heartbeat, default `4`, maximum `12`                        |
| `MISSION_CONCURRENCY`                  | No                 | Server                | Concurrent mission cycles, default `2`, maximum `4`                              |
| `MISSION_LEASE_SECONDS`                | No                 | Server                | Restart-recovery lease, default `60` seconds                                     |
| `MISSION_MAX_LIFETIME_MS`              | No                 | Server                | Hard mission lifetime, default four hours                                        |
| `MISSION_MAX_TOOL_EXECUTIONS_PER_WAKE` | No                 | Server                | Wake-cycle execution budget, default/maximum `12`                                |
| `INCIDENT_COMMANDER_DEMO_AUTO_APPROVE` | Demo               | Server                | `true` completes unattended; `false` waits for dashboard approval                |
| `NEMOCLAW_SANDBOX_NAME`                | Containment demo   | Server                | NemoClaw sandbox name                                                            |
| `OPENSHELL_LIVE_CONTAINMENT`           | Containment demo   | Server                | Enables live allow/deny proof                                                    |

For Docker Compose, `CONTAINER_SUPABASE_URL`, `CONTAINER_VLLM_BASE_URL`, and `CONTAINER_EMBEDDING_BASE_URL` optionally override host-bridge defaults.
