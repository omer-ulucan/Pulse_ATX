create or replace function public.record_runtime_policy_violation(
  p_destination text,
  p_binary text,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  finding_id uuid;
begin
  insert into public.security_findings (
    stage, provider, threat_type, severity, action_taken, details
  ) values (
    'runtime_policy',
    'openshell',
    'data_exfiltration',
    'high',
    'blocked',
    p_details || jsonb_build_object(
      'destination', p_destination,
      'binary', p_binary,
      'reason', left(p_reason, 1000)
    )
  )
  returning id into finding_id;

  insert into public.agent_timeline (event_type, message, metadata)
  values (
    'runtime_policy_violation',
    'OpenShell blocked an unauthorized outbound request',
    jsonb_build_object(
      'findingId', finding_id,
      'destination', p_destination,
      'binary', p_binary
    )
  );

  return finding_id;
end;
$$;

revoke all on function public.record_runtime_policy_violation(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_runtime_policy_violation(text, text, text, jsonb) to service_role;
