create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table public.raw_events (
  id uuid primary key default extensions.gen_random_uuid(),
  source text not null,
  external_id text not null,
  event_type text not null,
  payload jsonb not null,
  fingerprint text not null,
  revision integer not null default 1 check (revision > 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  processing_status text not null default 'analyzing' check (processing_status in ('analyzing', 'active', 'completed', 'failed', 'quarantined')),
  security_status text not null default 'pending' check (security_status in ('pending', 'passed', 'flagged', 'quarantined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.incidents (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  summary text not null default '',
  incident_type text not null,
  status text not null default 'analyzing' check (status in ('analyzing', 'active', 'monitoring', 'resolved', 'quarantined')),
  severity smallint check (severity between 1 and 5),
  confidence double precision check (confidence between 0 and 1),
  latitude double precision,
  longitude double precision,
  location_name text,
  predicted_duration_minutes integer check (predicted_duration_minutes >= 0),
  actual_duration_minutes integer check (actual_duration_minutes >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  first_detected_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.incident_events (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  raw_event_id uuid not null references public.raw_events(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('primary', 'supporting', 'correlated', 'conflicting', 'update')),
  created_at timestamptz not null default now(),
  unique (incident_id, raw_event_id, relationship_type)
);

create table public.agent_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid references public.incidents(id) on delete set null,
  raw_event_id uuid references public.raw_events(id) on delete set null,
  decision_type text not null,
  model_name text not null,
  prompt_version text not null,
  input_context jsonb not null default '{}'::jsonb,
  output jsonb not null,
  confidence double precision check (confidence between 0 and 1),
  latency_ms integer check (latency_ms >= 0),
  retrieved_memory_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  audience text not null,
  title text not null,
  message text not null,
  severity smallint not null check (severity between 1 and 5),
  recommended_actions jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'published', 'rejected')),
  requires_approval boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.incident_memories (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  summary text not null,
  lesson jsonb not null,
  embedding extensions.vector(384),
  quality_score double precision not null default 0.5 check (quality_score between 0 and 1),
  created_at timestamptz not null default now(),
  unique (incident_id)
);

create table public.incident_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  predicted_duration_minutes integer,
  actual_duration_minutes integer,
  predicted_severity smallint,
  observed_severity smallint,
  prediction_error double precision,
  outcome jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (incident_id)
);

create table public.security_findings (
  id uuid primary key default extensions.gen_random_uuid(),
  raw_event_id uuid references public.raw_events(id) on delete set null,
  incident_id uuid references public.incidents(id) on delete set null,
  stage text not null check (stage in ('feed_input', 'model_prompt', 'model_output', 'tool_call', 'tool_result', 'alert_output', 'runtime_policy')),
  provider text not null,
  threat_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  action_taken text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.agent_timeline (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid references public.incidents(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.event_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  raw_event_id uuid not null references public.raw_events(id) on delete cascade,
  raw_event_revision integer not null check (raw_event_revision > 0),
  job_type text not null default 'analyze_event',
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'quarantined')),
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (raw_event_id, raw_event_revision, job_type)
);

create table public.source_health (
  id uuid primary key default extensions.gen_random_uuid(),
  source text not null unique,
  last_poll_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  latency_ms integer check (latency_ms >= 0),
  items_received integer not null default 0 check (items_received >= 0),
  items_changed integer not null default 0 check (items_changed >= 0),
  status text not null default 'unknown' check (status in ('unknown', 'healthy', 'degraded', 'offline')),
  etag text,
  last_modified text,
  updated_at timestamptz not null default now()
);

create table public.agent_health (
  id uuid primary key default extensions.gen_random_uuid(),
  worker_id text not null unique,
  status text not null check (status in ('starting', 'healthy', 'degraded', 'stopping', 'offline')),
  last_heartbeat_at timestamptz not null default now(),
  heartbeat_interval_seconds integer not null check (heartbeat_interval_seconds > 0),
  pending_jobs integer not null default 0 check (pending_jobs >= 0),
  active_incidents integer not null default 0 check (active_incidents >= 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index raw_events_source_updated_idx on public.raw_events(source, source_updated_at desc);
create index incidents_active_idx on public.incidents(status, severity desc, last_updated_at desc);
create index incidents_location_idx on public.incidents(latitude, longitude) where latitude is not null and longitude is not null;
create index event_jobs_claim_idx on public.event_jobs(status, created_at) where status in ('pending', 'processing');
create index agent_timeline_created_idx on public.agent_timeline(created_at desc);
create index security_findings_created_idx on public.security_findings(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger raw_events_set_updated_at before update on public.raw_events for each row execute function public.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents for each row execute function public.set_updated_at();
create trigger event_jobs_set_updated_at before update on public.event_jobs for each row execute function public.set_updated_at();
create trigger source_health_set_updated_at before update on public.source_health for each row execute function public.set_updated_at();
create trigger agent_health_set_updated_at before update on public.agent_health for each row execute function public.set_updated_at();

create or replace function public.ingest_raw_event(
  p_source text,
  p_external_id text,
  p_event_type text,
  p_payload jsonb,
  p_fingerprint text,
  p_source_created_at timestamptz default null,
  p_source_updated_at timestamptz default null
)
returns table(raw_event_id uuid, revision integer, changed boolean, job_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_event public.raw_events%rowtype;
  stored_event public.raw_events%rowtype;
  stored_job_id uuid;
begin
  select * into existing_event
  from public.raw_events
  where source = p_source and external_id = p_external_id
  for update;

  if not found then
    insert into public.raw_events (
      source, external_id, event_type, payload, fingerprint,
      source_created_at, source_updated_at
    ) values (
      p_source, p_external_id, p_event_type, p_payload, p_fingerprint,
      p_source_created_at, p_source_updated_at
    ) returning * into stored_event;
  elsif existing_event.fingerprint = p_fingerprint then
    update public.raw_events
    set last_seen_at = now()
    where id = existing_event.id;

    return query select existing_event.id, existing_event.revision, false, null::uuid;
    return;
  else
    update public.raw_events
    set event_type = p_event_type,
        payload = p_payload,
        fingerprint = p_fingerprint,
        revision = existing_event.revision + 1,
        source_created_at = coalesce(p_source_created_at, existing_event.source_created_at),
        source_updated_at = p_source_updated_at,
        last_seen_at = now(),
        processing_status = 'analyzing',
        security_status = 'pending'
    where id = existing_event.id
    returning * into stored_event;
  end if;

  insert into public.event_jobs (raw_event_id, raw_event_revision, job_type)
  values (stored_event.id, stored_event.revision, 'analyze_event')
  on conflict (raw_event_id, raw_event_revision, job_type) do nothing
  returning id into stored_job_id;

  if stored_job_id is null then
    select id into stored_job_id
    from public.event_jobs
    where raw_event_id = stored_event.id
      and raw_event_revision = stored_event.revision
      and job_type = 'analyze_event';
  end if;

  return query select stored_event.id, stored_event.revision, true, stored_job_id;
end;
$$;

revoke all on function public.ingest_raw_event(text, text, text, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_raw_event(text, text, text, jsonb, text, timestamptz, timestamptz) to service_role;

alter table public.raw_events enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
alter table public.agent_decisions enable row level security;
alter table public.alerts enable row level security;
alter table public.incident_memories enable row level security;
alter table public.incident_outcomes enable row level security;
alter table public.security_findings enable row level security;
alter table public.agent_timeline enable row level security;
alter table public.event_jobs enable row level security;
alter table public.source_health enable row level security;
alter table public.agent_health enable row level security;

create policy "dashboard reads raw events" on public.raw_events for select to anon, authenticated using (true);
create policy "dashboard reads incidents" on public.incidents for select to anon, authenticated using (true);
create policy "dashboard reads incident events" on public.incident_events for select to anon, authenticated using (true);
create policy "dashboard reads alerts" on public.alerts for select to anon, authenticated using (true);
create policy "dashboard reads memories" on public.incident_memories for select to anon, authenticated using (true);
create policy "dashboard reads security findings" on public.security_findings for select to anon, authenticated using (true);
create policy "dashboard reads timeline" on public.agent_timeline for select to anon, authenticated using (true);
create policy "dashboard reads source health" on public.source_health for select to anon, authenticated using (true);
create policy "dashboard reads agent health" on public.agent_health for select to anon, authenticated using (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['raw_events', 'incidents', 'alerts', 'security_findings', 'agent_timeline', 'source_health', 'agent_health']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
