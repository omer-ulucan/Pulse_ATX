create or replace function public.claim_event_jobs(
  p_worker_id text,
  p_limit integer default 8
)
returns table(
  job_id uuid,
  raw_event_id uuid,
  raw_event_revision integer,
  attempts integer,
  source text,
  event_type text,
  payload jsonb,
  source_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimable as (
    select jobs.id
    from public.event_jobs jobs
    where jobs.status = 'pending'
    order by jobs.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 8))
  ), claimed as (
    update public.event_jobs jobs
    set status = 'processing',
        attempts = jobs.attempts + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        error = null
    from claimable
    where jobs.id = claimable.id
    returning jobs.*
  )
  select
    claimed.id,
    claimed.raw_event_id,
    claimed.raw_event_revision,
    claimed.attempts,
    events.source,
    events.event_type,
    events.payload,
    events.source_updated_at
  from claimed
  join public.raw_events events on events.id = claimed.raw_event_id;
end;
$$;

create or replace function public.persist_analysis_result(
  p_job_id uuid,
  p_worker_id text,
  p_model_name text,
  p_prompt_version text,
  p_input_context jsonb,
  p_decision jsonb,
  p_latency_ms integer,
  p_used_fallback boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  claimed_job public.event_jobs%rowtype;
  source_event public.raw_events%rowtype;
  stored_incident_id uuid;
  parsed_latitude double precision;
  parsed_longitude double precision;
begin
  select * into claimed_job
  from public.event_jobs
  where id = p_job_id and status = 'processing' and locked_by = p_worker_id
  for update;
  if not found then
    raise exception 'job % is not claimed by worker %', p_job_id, p_worker_id;
  end if;

  select * into source_event from public.raw_events where id = claimed_job.raw_event_id;
  if source_event.payload->>'latitude' ~ '^-?[0-9]+(\.[0-9]+)?$' then
    parsed_latitude := (source_event.payload->>'latitude')::double precision;
  end if;
  if source_event.payload->>'longitude' ~ '^-?[0-9]+(\.[0-9]+)?$' then
    parsed_longitude := (source_event.payload->>'longitude')::double precision;
  end if;

  select incident_id into stored_incident_id
  from public.incident_events
  where raw_event_id = source_event.id
  order by created_at
  limit 1;

  if stored_incident_id is null then
    insert into public.incidents (
      title, summary, incident_type, status, severity, confidence,
      latitude, longitude, location_name, predicted_duration_minutes,
      started_at, first_detected_at, last_updated_at
    ) values (
      p_decision->>'title',
      p_decision->>'summary',
      p_decision->>'incident_type',
      'active',
      (p_decision->>'severity')::smallint,
      (p_decision->>'confidence')::double precision,
      parsed_latitude,
      parsed_longitude,
      coalesce(source_event.payload->>'address', source_event.payload->>'location_name'),
      (p_decision->>'predicted_duration_minutes')::integer,
      coalesce(source_event.source_created_at, source_event.first_seen_at),
      source_event.first_seen_at,
      now()
    ) returning id into stored_incident_id;

    insert into public.incident_events (incident_id, raw_event_id, relationship_type)
    values (stored_incident_id, source_event.id, 'primary')
    on conflict do nothing;
  else
    update public.incidents
    set title = p_decision->>'title',
        summary = p_decision->>'summary',
        incident_type = p_decision->>'incident_type',
        status = 'active',
        severity = (p_decision->>'severity')::smallint,
        confidence = (p_decision->>'confidence')::double precision,
        predicted_duration_minutes = (p_decision->>'predicted_duration_minutes')::integer,
        last_updated_at = now()
    where id = stored_incident_id;
  end if;

  insert into public.agent_decisions (
    incident_id, raw_event_id, decision_type, model_name, prompt_version,
    input_context, output, confidence, latency_ms
  ) values (
    stored_incident_id,
    source_event.id,
    case when p_used_fallback then 'incident_analysis_fallback' else 'incident_analysis' end,
    p_model_name,
    p_prompt_version,
    p_input_context,
    p_decision,
    (p_decision->>'confidence')::double precision,
    p_latency_ms
  );

  insert into public.agent_timeline (incident_id, event_type, message, metadata)
  values (
    stored_incident_id,
    'analysis_completed',
    case when p_used_fallback then 'Deterministic fallback completed event analysis' else 'Nemotron completed structured event analysis' end,
    jsonb_build_object('jobId', p_job_id, 'model', p_model_name, 'fallback', p_used_fallback)
  );

  update public.raw_events
  set processing_status = 'active'
  where id = source_event.id;

  update public.event_jobs
  set status = 'completed', completed_at = now(), locked_at = null, locked_by = null
  where id = p_job_id;

  return stored_incident_id;
end;
$$;

create or replace function public.fail_event_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_max_attempts integer default 3
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text;
begin
  update public.event_jobs
  set status = case when attempts >= p_max_attempts then 'failed' else 'pending' end,
      error = left(p_error, 4000),
      locked_at = null,
      locked_by = null
  where id = p_job_id and status = 'processing' and locked_by = p_worker_id
  returning status into next_status;

  if next_status is null then
    raise exception 'job % is not claimed by worker %', p_job_id, p_worker_id;
  end if;
  return next_status;
end;
$$;

revoke all on function public.claim_event_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.persist_analysis_result(uuid, text, text, text, jsonb, jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public.fail_event_job(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_event_jobs(text, integer) to service_role;
grant execute on function public.persist_analysis_result(uuid, text, text, text, jsonb, jsonb, integer, boolean) to service_role;
grant execute on function public.fail_event_job(uuid, text, text, integer) to service_role;

