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
  select events.* into existing_event
  from public.raw_events events
  where events.source = p_source and events.external_id = p_external_id
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
    update public.raw_events events
    set last_seen_at = now()
    where events.id = existing_event.id;

    return query select existing_event.id, existing_event.revision, false, null::uuid;
    return;
  else
    update public.raw_events events
    set event_type = p_event_type,
        payload = p_payload,
        fingerprint = p_fingerprint,
        revision = existing_event.revision + 1,
        source_created_at = coalesce(p_source_created_at, existing_event.source_created_at),
        source_updated_at = p_source_updated_at,
        last_seen_at = now(),
        processing_status = 'analyzing',
        security_status = 'pending'
    where events.id = existing_event.id
    returning * into stored_event;
  end if;

  insert into public.event_jobs (raw_event_id, raw_event_revision, job_type)
  values (stored_event.id, stored_event.revision, 'analyze_event')
  on conflict on constraint event_jobs_raw_event_id_raw_event_revision_job_type_key
  do nothing
  returning id into stored_job_id;

  if stored_job_id is null then
    select jobs.id into stored_job_id
    from public.event_jobs jobs
    where jobs.raw_event_id = stored_event.id
      and jobs.raw_event_revision = stored_event.revision
      and jobs.job_type = 'analyze_event';
  end if;

  return query select stored_event.id, stored_event.revision, true, stored_job_id;
end;
$$;

revoke all on function public.ingest_raw_event(text, text, text, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_raw_event(text, text, text, jsonb, text, timestamptz, timestamptz) to service_role;
