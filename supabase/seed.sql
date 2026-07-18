-- Demo data is inserted through the same idempotent ingestion RPC used by the worker.
with seed_event as (
  select '{"issue_reported":"COLLISION","location_name":"N Lamar Blvd / W 24th St","latitude":30.2884,"longitude":-97.7417,"status":"ACTIVE"}'::jsonb as payload
)
select ingestion.*
from seed_event
cross join lateral public.ingest_raw_event(
  'austin_traffic',
  'seed-collision-001',
  'traffic_incident',
  seed_event.payload,
  encode(extensions.digest(seed_event.payload::text, 'sha256'), 'hex'),
  now() - interval '4 minutes',
  now() - interval '2 minutes'
) ingestion;
