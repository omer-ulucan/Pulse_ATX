create table public.agent_missions (
  id uuid primary key default extensions.gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  goal text not null check (char_length(goal) >= 10),
  status text not null check (
    status in (
      'planning',
      'active',
      'waiting',
      'waiting_approval',
      'completed',
      'cancelled',
      'failed'
    )
  ),
  priority integer not null default 3 check (priority between 1 and 5),
  current_step integer not null default 0 check (current_step >= 0),
  plan_version integer not null default 1 check (plan_version between 1 and 4),
  wake_cycle integer not null default 0 check (wake_cycle >= 0),
  trigger_reason jsonb not null default '{}'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  failure_reason text,
  next_wake_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_mission_steps (
  id uuid primary key default extensions.gen_random_uuid(),
  mission_id uuid not null references public.agent_missions(id) on delete cascade,
  step_order integer not null check (step_order > 0 and step_order <= 8),
  plan_version integer not null check (plan_version between 1 and 4),
  tool_name text not null,
  tool_arguments jsonb not null default '{}'::jsonb,
  rationale text,
  requires_fresh_observation boolean not null default false,
  status text not null check (
    status in (
      'planned',
      'running',
      'waiting',
      'waiting_approval',
      'completed',
      'failed',
      'skipped',
      'cancelled'
    )
  ),
  result jsonb,
  decision_audit jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mission_id, plan_version, step_order)
);

create table public.agent_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  mission_id uuid not null references public.agent_missions(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  observation_type text not null,
  state_snapshot jsonb not null,
  state_fingerprint text not null,
  change_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(mission_id, state_fingerprint)
);

create table public.agent_tool_executions (
  id uuid primary key default extensions.gen_random_uuid(),
  mission_id uuid not null references public.agent_missions(id) on delete cascade,
  mission_step_id uuid references public.agent_mission_steps(id) on delete set null,
  approval_alert_id uuid references public.alerts(id) on delete set null,
  tool_name text not null,
  arguments jsonb not null,
  arguments_fingerprint text not null,
  security_status text not null,
  approval_status text check (
    approval_status is null
    or approval_status in ('not_required', 'pending', 'approved', 'rejected')
  ),
  status text not null check (
    status in (
      'pending',
      'running',
      'blocked',
      'completed',
      'failed'
    )
  ),
  result jsonb,
  error text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(mission_id, tool_name, arguments_fingerprint)
);

create unique index agent_missions_active_incident_unique_idx
on public.agent_missions(incident_id)
where status in ('planning', 'active', 'waiting', 'waiting_approval');

create index agent_missions_due_idx
on public.agent_missions(status, next_wake_at)
where status in ('planning', 'active', 'waiting', 'waiting_approval');

create index agent_missions_incident_idx
on public.agent_missions(incident_id, created_at desc);

create index agent_mission_steps_status_idx
on public.agent_mission_steps(mission_id, plan_version, status, step_order);

create index agent_observations_incident_idx
on public.agent_observations(incident_id, created_at desc);

create index agent_observations_mission_created_idx
on public.agent_observations(mission_id, created_at desc);

create index agent_tool_executions_mission_created_idx
on public.agent_tool_executions(mission_id, created_at desc);

create index agent_timeline_incident_created_idx
on public.agent_timeline(incident_id, created_at desc);

create trigger agent_missions_set_updated_at
before update on public.agent_missions
for each row execute function public.set_updated_at();

create trigger agent_mission_steps_set_updated_at
before update on public.agent_mission_steps
for each row execute function public.set_updated_at();

alter table public.agent_missions enable row level security;
alter table public.agent_mission_steps enable row level security;
alter table public.agent_observations enable row level security;
alter table public.agent_tool_executions enable row level security;

create policy "dashboard reads missions"
on public.agent_missions for select to anon, authenticated using (true);

create policy "dashboard reads mission steps"
on public.agent_mission_steps for select to anon, authenticated using (true);

create policy "dashboard reads mission observations"
on public.agent_observations for select to anon, authenticated using (true);

create policy "dashboard reads mission tool executions"
on public.agent_tool_executions for select to anon, authenticated using (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'agent_missions',
    'agent_mission_steps',
    'agent_observations',
    'agent_tool_executions'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
