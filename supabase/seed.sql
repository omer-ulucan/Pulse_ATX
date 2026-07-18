-- Demo data is inserted through the same idempotent ingestion RPC used by the worker.
select *
from public.ingest_raw_event(
  'austin_traffic',
  'seed-collision-001',
  'traffic_incident',
  '{"issue_reported":"COLLISION","location_name":"N Lamar Blvd / W 24th St","latitude":30.2884,"longitude":-97.7417,"status":"ACTIVE"}'::jsonb,
  'seed-fingerprint-v1',
  now() - interval '4 minutes',
  now() - interval '2 minutes'
);

