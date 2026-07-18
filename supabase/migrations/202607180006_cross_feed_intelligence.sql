create or replace function public.list_cross_feed_candidates(p_raw_event_id uuid)
returns table(
  incident_id uuid,
  source text,
  event_type text,
  payload jsonb,
  summary text,
  severity smallint,
  predicted_duration_minutes integer,
  latitude double precision,
  longitude double precision,
  location_name text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with incoming as (
    select source from public.raw_events where id = p_raw_event_id
  )
  select
    incidents.id,
    events.source,
    events.event_type,
    events.payload,
    incidents.summary,
    incidents.severity,
    incidents.predicted_duration_minutes,
    incidents.latitude,
    incidents.longitude,
    incidents.location_name,
    coalesce(events.source_updated_at, events.source_created_at, events.first_seen_at)
  from public.incidents incidents
  join public.incident_events links
    on links.incident_id = incidents.id and links.relationship_type = 'primary'
  join public.raw_events events on events.id = links.raw_event_id
  cross join incoming
  where incidents.status in ('active', 'monitoring')
    and events.source <> incoming.source
    and coalesce(events.source_updated_at, events.source_created_at, events.first_seen_at)
      >= now() - interval '4 hours'
  order by incidents.last_updated_at desc
  limit 100;
$$;

create or replace function public.apply_cross_feed_correlation(
  p_job_id uuid,
  p_worker_id text,
  p_incident_id uuid,
  p_decision jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_job public.event_jobs%rowtype;
  existing_incident_id uuid;
begin
  select incident_id into existing_incident_id
  from public.incident_events
  where raw_event_id = (select raw_event_id from public.event_jobs where id = p_job_id)
  order by created_at
  limit 1;
  if existing_incident_id is not null then return existing_incident_id; end if;

  select * into claimed_job
  from public.event_jobs
  where id = p_job_id and status = 'processing' and locked_by = p_worker_id
  for update;
  if not found then
    raise exception 'job % is not claimed by worker %', p_job_id, p_worker_id;
  end if;

  perform 1 from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'incident % not found', p_incident_id; end if;

  insert into public.incident_events (incident_id, raw_event_id, relationship_type)
  values (p_incident_id, claimed_job.raw_event_id, 'correlated')
  on conflict do nothing;

  update public.incidents
  set severity = greatest(coalesce(severity, 1), (p_decision->>'severity')::smallint),
      predicted_duration_minutes = greatest(
        coalesce(predicted_duration_minutes, 0),
        (p_decision->>'durationMinutes')::integer
      ),
      status = 'active',
      last_updated_at = now()
  where id = p_incident_id;

  insert into public.agent_timeline (incident_id, event_type, message, metadata)
  values (
    p_incident_id,
    'cross_feed_correlation',
    'A supporting public feed escalated this incident',
    p_decision || jsonb_build_object('rawEventId', claimed_job.raw_event_id)
  );

  update public.raw_events
  set processing_status = 'active'
  where id = claimed_job.raw_event_id;

  update public.event_jobs
  set status = 'completed', completed_at = now(), locked_at = null, locked_by = null
  where id = p_job_id;

  return p_incident_id;
end;
$$;

revoke all on function public.list_cross_feed_candidates(uuid) from public, anon, authenticated;
revoke all on function public.apply_cross_feed_correlation(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.list_cross_feed_candidates(uuid) to service_role;
grant execute on function public.apply_cross_feed_correlation(uuid, text, uuid, jsonb) to service_role;
