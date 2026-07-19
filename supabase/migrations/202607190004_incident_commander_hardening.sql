create or replace function public.cancel_pending_missions_on_incident_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mission public.agent_missions%rowtype;
begin
  if old.status = 'resolved' or new.status <> 'resolved' then
    return new;
  end if;

  for mission in
    select missions.*
    from public.agent_missions missions
    where missions.incident_id = new.id
      and missions.status in ('planning', 'active', 'waiting', 'waiting_approval')
      and not (
        missions.status = 'active'
        and exists (
          select 1
          from public.agent_mission_steps steps
          where steps.mission_id = missions.id
            and steps.plan_version = missions.plan_version
            and steps.tool_name = 'close_incident'
            and steps.status in ('planned', 'running')
        )
      )
    for update
  loop
    update public.agent_tool_executions
    set approval_status = 'rejected',
        status = 'blocked',
        error = 'Incident resolved before the protected action executed',
        completed_at = now()
    where mission_id = mission.id
      and approval_status = 'pending'
      and status = 'blocked';

    update public.agent_mission_steps
    set status = 'cancelled',
        error = 'Incident resolved before the pending plan completed',
        completed_at = now()
    where mission_id = mission.id
      and plan_version = mission.plan_version
      and status in ('planned', 'running', 'waiting', 'waiting_approval');

    update public.agent_missions
    set status = 'cancelled',
        failure_reason = 'Incident resolved before the pending plan completed',
        next_wake_at = null,
        claimed_by = null,
        lease_expires_at = null,
        completed_at = now()
    where id = mission.id;

    insert into public.agent_timeline (incident_id, event_type, message, metadata)
    values (
      new.id,
      'mission_cancelled_incident_resolved',
      'Pending action cancelled because the incident resolved',
      jsonb_build_object('missionId', mission.id)
    );
  end loop;
  return new;
end;
$$;

create trigger incidents_cancel_pending_missions
after update of status on public.incidents
for each row
when (old.status is distinct from new.status and new.status = 'resolved')
execute function public.cancel_pending_missions_on_incident_resolution();

create or replace function public.decide_agent_tool_approval(
  p_execution_id uuid,
  p_operator text,
  p_approved boolean
)
returns public.agent_tool_executions
language plpgsql
security definer
set search_path = public
as $$
declare
  execution public.agent_tool_executions%rowtype;
  mission public.agent_missions%rowtype;
begin
  if char_length(trim(p_operator)) < 2 then
    raise exception 'operator identity is required';
  end if;

  select * into execution
  from public.agent_tool_executions
  where id = p_execution_id
  for update;
  if execution.id is null then
    raise exception 'tool execution not found';
  end if;

  select * into mission
  from public.agent_missions
  where id = execution.mission_id
  for update;
  if mission.id is null then
    raise exception 'mission not found';
  end if;

  if execution.approval_status in ('approved', 'rejected') then
    return execution;
  end if;
  if mission.status <> 'waiting_approval' then
    raise exception 'mission is not waiting for approval';
  end if;
  if execution.approval_status <> 'pending' or execution.status <> 'blocked' then
    raise exception 'tool execution is not pending approval';
  end if;

  update public.agent_tool_executions
  set approval_status = case when p_approved then 'approved' else 'rejected' end
  where id = p_execution_id
  returning * into execution;

  if execution.approval_alert_id is not null then
    update public.alerts
    set status = case when p_approved then 'approved' else 'rejected' end,
        approved_by = case when p_approved then trim(p_operator) else null end,
        approved_at = case when p_approved then now() else null end
    where id = execution.approval_alert_id and status = 'pending_approval';
  end if;

  insert into public.agent_timeline (incident_id, event_type, message, metadata)
  values (
    mission.incident_id,
    case when p_approved then 'mission_action_approved' else 'mission_action_rejected' end,
    case when p_approved then 'Operator approved action' else 'Operator rejected action' end,
    jsonb_build_object(
      'missionId', mission.id,
      'toolExecutionId', execution.id,
      'toolName', execution.tool_name,
      'operator', trim(p_operator)
    )
  );
  return execution;
end;
$$;

revoke all on function public.cancel_pending_missions_on_incident_resolution()
from public, anon, authenticated;
revoke all on function public.decide_agent_tool_approval(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.decide_agent_tool_approval(uuid, text, boolean)
to service_role;
