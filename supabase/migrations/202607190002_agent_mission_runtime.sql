create or replace function public.create_agent_mission(
  p_incident_id uuid,
  p_goal text,
  p_priority integer,
  p_trigger_reason jsonb
)
returns public.agent_missions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored_mission public.agent_missions%rowtype;
begin
  if char_length(trim(p_goal)) < 10 then raise exception 'mission goal is too short'; end if;
  if p_priority not between 1 and 5 then raise exception 'mission priority is out of range'; end if;
  perform 1 from public.incidents where id = p_incident_id;
  if not found then raise exception 'incident % not found', p_incident_id; end if;

  insert into public.agent_missions (
    incident_id, goal, status, priority, trigger_reason
  ) values (
    p_incident_id, trim(p_goal), 'planning', p_priority, coalesce(p_trigger_reason, '{}'::jsonb)
  )
  on conflict (incident_id) where status in ('planning', 'active', 'waiting', 'waiting_approval')
  do nothing
  returning * into stored_mission;

  if stored_mission.id is null then
    select * into stored_mission
    from public.agent_missions
    where incident_id = p_incident_id
      and status in ('planning', 'active', 'waiting', 'waiting_approval')
    order by created_at desc
    limit 1;
  else
    insert into public.agent_timeline (incident_id, event_type, message, metadata)
    values (
      p_incident_id,
      'mission_created',
      'Mission created',
      jsonb_build_object(
        'missionId', stored_mission.id,
        'priority', stored_mission.priority,
        'triggerReason', stored_mission.trigger_reason
      )
    );
  end if;
  return stored_mission;
end;
$$;

create or replace function public.claim_agent_missions(
  p_worker_id text,
  p_limit integer default 4,
  p_lease_seconds integer default 60
)
returns setof public.agent_missions
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(trim(p_worker_id)) < 1 then raise exception 'worker id is required'; end if;
  if p_limit not between 1 and 12 then raise exception 'mission claim limit is out of range'; end if;
  if p_lease_seconds not between 15 and 300 then raise exception 'mission lease is out of range'; end if;

  return query
  with candidates as (
    select missions.id
    from public.agent_missions missions
    where (
      missions.status in ('planning', 'active')
      or (missions.status = 'waiting' and missions.next_wake_at <= now())
      or (
        missions.status = 'waiting_approval'
        and exists (
          select 1
          from public.agent_tool_executions executions
          where executions.mission_id = missions.id
            and executions.approval_status in ('approved', 'rejected')
        )
      )
    )
      and (missions.claimed_by is null or missions.lease_expires_at < now())
    order by
      missions.priority desc,
      coalesce(missions.next_wake_at, missions.created_at),
      missions.created_at
    for update skip locked
    limit p_limit
  )
  update public.agent_missions missions
  set claimed_by = trim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  from candidates
  where missions.id = candidates.id
  returning missions.*;
end;
$$;

create or replace function public.release_agent_mission_claim(
  p_mission_id uuid,
  p_worker_id text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.agent_missions
  set claimed_by = null, lease_expires_at = null
  where id = p_mission_id and claimed_by = p_worker_id
  returning true;
$$;

create or replace function public.persist_agent_mission_plan(
  p_mission_id uuid,
  p_plan_version integer,
  p_plan jsonb,
  p_used_fallback boolean,
  p_validation_failures jsonb
)
returns public.agent_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  mission public.agent_missions%rowtype;
  plan_step jsonb;
  step_count integer;
  expected_order integer := 1;
  allowed_tools constant text[] := array[
    'retrieve_similar_incidents', 'get_incident_snapshot',
    'find_affected_transit_routes', 'check_weather_conditions',
    'calculate_impact_change', 'update_incident_severity',
    'create_alert_draft', 'revise_alert_draft', 'request_human_approval',
    'publish_simulated_alert', 'schedule_incident_recheck',
    'cancel_pending_action', 'close_incident', 'record_incident_outcome',
    'store_incident_lesson'
  ];
begin
  select * into mission from public.agent_missions where id = p_mission_id for update;
  if not found then raise exception 'mission % not found', p_mission_id; end if;
  if mission.status not in ('planning', 'active') then
    raise exception 'mission % cannot persist a plan while %', p_mission_id, mission.status;
  end if;
  if p_plan_version not between 1 and 4 then raise exception 'plan version is out of range'; end if;
  if mission.status = 'planning' and p_plan_version <> 1 then raise exception 'initial plan must be version 1'; end if;
  if mission.status = 'active' and p_plan_version <> mission.plan_version + 1 then
    raise exception 'replacement plan version must increment exactly once';
  end if;
  step_count := jsonb_array_length(coalesce(p_plan->'steps', '[]'::jsonb));
  if step_count not between 1 and 8 then raise exception 'plan must contain 1 to 8 steps'; end if;

  for plan_step in select value from jsonb_array_elements(p_plan->'steps')
  loop
    if (plan_step->>'order')::integer <> expected_order then
      raise exception 'mission steps must be sequential from 1';
    end if;
    if not ((plan_step->>'tool') = any(allowed_tools)) then
      raise exception 'tool % is not allowlisted', plan_step->>'tool';
    end if;
    insert into public.agent_mission_steps (
      mission_id, step_order, plan_version, tool_name, tool_arguments,
      rationale, requires_fresh_observation, status
    ) values (
      p_mission_id,
      expected_order,
      p_plan_version,
      plan_step->>'tool',
      coalesce(plan_step->'arguments', '{}'::jsonb),
      plan_step->>'rationale',
      coalesce((plan_step->>'requiresFreshObservation')::boolean, false),
      'planned'
    );
    expected_order := expected_order + 1;
  end loop;

  if p_plan_version > mission.plan_version then
    update public.agent_mission_steps
    set status = 'cancelled', completed_at = now()
    where mission_id = p_mission_id
      and plan_version = mission.plan_version
      and status in ('planned', 'waiting');
  end if;

  update public.agent_missions
  set goal = left(p_plan->>'goal', 1000),
      status = 'active',
      priority = (p_plan->>'priority')::integer,
      current_step = 0,
      plan_version = p_plan_version,
      success_criteria = coalesce(p_plan->'successCriteria', '[]'::jsonb),
      assumptions = coalesce(p_plan->'assumptions', '[]'::jsonb),
      next_wake_at = null,
      failure_reason = null
  where id = p_mission_id
  returning * into mission;

  insert into public.agent_timeline (incident_id, event_type, message, metadata)
  values (
    mission.incident_id,
    'mission_plan_created',
    format('Plan version %s created', p_plan_version),
    jsonb_build_object(
      'missionId', mission.id,
      'planVersion', p_plan_version,
      'stepCount', step_count,
      'usedFallback', p_used_fallback,
      'validationFailures', coalesce(p_validation_failures, '[]'::jsonb)
    )
  );
  return mission;
end;
$$;

create or replace function public.transition_agent_mission(
  p_mission_id uuid,
  p_expected_statuses text[],
  p_status text,
  p_patch jsonb default '{}'::jsonb
)
returns public.agent_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  mission public.agent_missions%rowtype;
begin
  if p_status not in ('planning', 'active', 'waiting', 'waiting_approval', 'completed', 'cancelled', 'failed') then
    raise exception 'invalid mission status %', p_status;
  end if;
  update public.agent_missions
  set status = p_status,
      current_step = case when p_patch ? 'currentStep' then (p_patch->>'currentStep')::integer else current_step end,
      wake_cycle = case when p_patch ? 'wakeCycle' then (p_patch->>'wakeCycle')::integer else wake_cycle end,
      failure_reason = case when p_patch ? 'failureReason' then p_patch->>'failureReason' else failure_reason end,
      next_wake_at = case when p_patch ? 'nextWakeAt' then (p_patch->>'nextWakeAt')::timestamptz else next_wake_at end,
      completed_at = case when p_patch ? 'completedAt' then (p_patch->>'completedAt')::timestamptz else completed_at end,
      claimed_by = case when p_status in ('waiting', 'waiting_approval', 'completed', 'cancelled', 'failed') then null else claimed_by end,
      lease_expires_at = case when p_status in ('waiting', 'waiting_approval', 'completed', 'cancelled', 'failed') then null else lease_expires_at end
  where id = p_mission_id and status = any(p_expected_statuses)
  returning * into mission;
  if mission.id is null then raise exception 'mission transition compare-and-set failed'; end if;
  return mission;
end;
$$;

create or replace function public.start_agent_mission_step(p_step_id uuid)
returns public.agent_mission_steps
language plpgsql
security definer
set search_path = public
as $$
declare stored_step public.agent_mission_steps%rowtype;
begin
  update public.agent_mission_steps
  set status = 'running', started_at = now(), completed_at = null, error = null
  where id = p_step_id and status in ('planned', 'waiting', 'waiting_approval')
  returning * into stored_step;
  if stored_step.id is null then raise exception 'mission step is not runnable'; end if;
  return stored_step;
end;
$$;

create or replace function public.finish_agent_mission_step(
  p_step_id uuid,
  p_status text,
  p_result jsonb,
  p_error text,
  p_decision_audit jsonb
)
returns public.agent_mission_steps
language plpgsql
security definer
set search_path = public
as $$
declare stored_step public.agent_mission_steps%rowtype;
begin
  if p_status not in ('waiting', 'waiting_approval', 'completed', 'failed', 'skipped', 'cancelled') then
    raise exception 'invalid terminal step status %', p_status;
  end if;
  update public.agent_mission_steps
  set status = p_status,
      result = p_result,
      error = p_error,
      decision_audit = p_decision_audit,
      completed_at = case when p_status in ('completed', 'failed', 'skipped', 'cancelled') then now() else null end
  where id = p_step_id and status = 'running'
  returning * into stored_step;
  if stored_step.id is null then raise exception 'mission step finish compare-and-set failed'; end if;
  return stored_step;
end;
$$;

create or replace function public.begin_agent_tool_execution(
  p_mission_id uuid,
  p_mission_step_id uuid,
  p_tool_name text,
  p_arguments jsonb,
  p_arguments_fingerprint text,
  p_security_status text,
  p_approval_required boolean
)
returns public.agent_tool_executions
language plpgsql
security definer
set search_path = public
as $$
declare execution public.agent_tool_executions%rowtype;
declare resolved_alert_id uuid;
begin
  if p_approval_required then
    if nullif(p_arguments->>'alertId', '') is not null then
      resolved_alert_id := (p_arguments->>'alertId')::uuid;
    else
      select alerts.id into resolved_alert_id
      from public.alerts alerts
      join public.agent_missions missions on missions.incident_id = alerts.incident_id
      where missions.id = p_mission_id and alerts.status <> 'rejected'
      order by alerts.created_at desc
      limit 1;
    end if;
  end if;
  insert into public.agent_tool_executions (
    mission_id, mission_step_id, approval_alert_id, tool_name, arguments, arguments_fingerprint,
    security_status, approval_status, status
  ) values (
    p_mission_id, p_mission_step_id, resolved_alert_id, p_tool_name, p_arguments, p_arguments_fingerprint,
    p_security_status,
    case when p_approval_required then 'pending' else 'not_required' end,
    case when p_approval_required then 'blocked' else 'pending' end
  )
  on conflict (mission_id, tool_name, arguments_fingerprint) do nothing
  returning * into execution;

  if execution.id is null then
    select * into execution
    from public.agent_tool_executions
    where mission_id = p_mission_id
      and tool_name = p_tool_name
      and arguments_fingerprint = p_arguments_fingerprint;
  end if;
  return execution;
end;
$$;

create or replace function public.finish_agent_tool_execution(
  p_execution_id uuid,
  p_status text,
  p_result jsonb,
  p_error text,
  p_latency_ms integer,
  p_security_status text
)
returns public.agent_tool_executions
language plpgsql
security definer
set search_path = public
as $$
declare execution public.agent_tool_executions%rowtype;
begin
  if p_status not in ('blocked', 'completed', 'failed') then raise exception 'invalid execution status'; end if;
  update public.agent_tool_executions
  set status = p_status,
      result = p_result,
      error = p_error,
      latency_ms = p_latency_ms,
      security_status = p_security_status,
      started_at = coalesce(started_at, now()),
      completed_at = now()
  where id = p_execution_id
  returning * into execution;
  if execution.id is null then raise exception 'tool execution not found'; end if;
  return execution;
end;
$$;

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
declare execution public.agent_tool_executions%rowtype;
declare mission public.agent_missions%rowtype;
begin
  if char_length(trim(p_operator)) < 2 then raise exception 'operator identity is required'; end if;
  update public.agent_tool_executions
  set approval_status = case when p_approved then 'approved' else 'rejected' end
  where id = p_execution_id and approval_status = 'pending' and status = 'blocked'
  returning * into execution;
  if execution.id is null then
    select * into execution from public.agent_tool_executions where id = p_execution_id;
    if execution.id is null then raise exception 'tool execution not found'; end if;
    if execution.approval_status not in ('approved', 'rejected') then
      raise exception 'tool execution is not pending approval';
    end if;
    return execution;
  end if;

  select * into mission from public.agent_missions where id = execution.mission_id;
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

revoke all on function public.create_agent_mission(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.claim_agent_missions(text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_agent_mission_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.persist_agent_mission_plan(uuid, integer, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.transition_agent_mission(uuid, text[], text, jsonb) from public, anon, authenticated;
revoke all on function public.start_agent_mission_step(uuid) from public, anon, authenticated;
revoke all on function public.finish_agent_mission_step(uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.begin_agent_tool_execution(uuid, uuid, text, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.finish_agent_tool_execution(uuid, text, jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public.decide_agent_tool_approval(uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.create_agent_mission(uuid, text, integer, jsonb) to service_role;
grant execute on function public.claim_agent_missions(text, integer, integer) to service_role;
grant execute on function public.release_agent_mission_claim(uuid, text) to service_role;
grant execute on function public.persist_agent_mission_plan(uuid, integer, jsonb, boolean, jsonb) to service_role;
grant execute on function public.transition_agent_mission(uuid, text[], text, jsonb) to service_role;
grant execute on function public.start_agent_mission_step(uuid) to service_role;
grant execute on function public.finish_agent_mission_step(uuid, text, jsonb, text, jsonb) to service_role;
grant execute on function public.begin_agent_tool_execution(uuid, uuid, text, jsonb, text, text, boolean) to service_role;
grant execute on function public.finish_agent_tool_execution(uuid, text, jsonb, text, integer, text) to service_role;
grant execute on function public.decide_agent_tool_approval(uuid, text, boolean) to service_role;
