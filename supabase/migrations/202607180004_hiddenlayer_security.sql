create or replace function public.quarantine_event_job(
  p_job_id uuid,
  p_worker_id text,
  p_stage text,
  p_provider text,
  p_threat_type text,
  p_severity text,
  p_action_taken text,
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  claimed_job public.event_jobs%rowtype;
  finding_id uuid;
begin
  select * into claimed_job
  from public.event_jobs
  where id = p_job_id and status = 'processing' and locked_by = p_worker_id
  for update;
  if not found then
    raise exception 'job % is not claimed by worker %', p_job_id, p_worker_id;
  end if;

  insert into public.security_findings (
    raw_event_id, stage, provider, threat_type, severity, action_taken, details
  ) values (
    claimed_job.raw_event_id, p_stage, p_provider, p_threat_type,
    p_severity, p_action_taken, p_details
  ) returning id into finding_id;

  update public.raw_events
  set processing_status = 'quarantined', security_status = 'quarantined'
  where id = claimed_job.raw_event_id;

  update public.event_jobs
  set status = 'quarantined', completed_at = now(), locked_at = null,
      locked_by = null, error = p_threat_type
  where id = claimed_job.id;

  insert into public.agent_timeline (event_type, message, metadata)
  values (
    'security_quarantine',
    'HiddenLayer blocked an untrusted event before downstream execution',
    jsonb_build_object('findingId', finding_id, 'rawEventId', claimed_job.raw_event_id, 'stage', p_stage)
  );

  return finding_id;
end;
$$;

revoke all on function public.quarantine_event_job(uuid, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.quarantine_event_job(uuid, text, text, text, text, text, text, jsonb) to service_role;

