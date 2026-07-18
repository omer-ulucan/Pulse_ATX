create or replace function public.recover_stale_event_jobs(
  p_stale_before timestamptz,
  p_max_attempts integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  recovered_count integer;
begin
  with recovered as (
    update public.event_jobs
    set status = case when attempts >= p_max_attempts then 'failed' else 'pending' end,
        locked_at = null,
        locked_by = null,
        error = case
          when attempts >= p_max_attempts then 'stale processing lock exceeded retry limit'
          else 'recovered stale processing lock'
        end
    where status = 'processing'
      and locked_at < p_stale_before
    returning id
  )
  select count(*)::integer into recovered_count from recovered;

  return recovered_count;
end;
$$;

revoke all on function public.recover_stale_event_jobs(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_event_jobs(timestamptz, integer) to service_role;

