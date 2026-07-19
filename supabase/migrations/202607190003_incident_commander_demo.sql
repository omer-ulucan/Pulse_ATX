alter table public.agent_missions
drop constraint if exists agent_missions_plan_version_check;

alter table public.agent_missions
add constraint agent_missions_plan_version_check
check (plan_version between 1 and 4);

alter table public.agent_mission_steps
drop constraint if exists agent_mission_steps_plan_version_check;

alter table public.agent_mission_steps
add constraint agent_mission_steps_plan_version_check
check (plan_version between 1 and 4);

create or replace function public.advance_waiting_mission_on_incident_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  advanced_count integer;
begin
  update public.agent_missions
  set next_wake_at = now()
  where incident_id = new.id and status = 'waiting';
  get diagnostics advanced_count = row_count;
  if advanced_count > 0 then
    insert into public.agent_timeline (incident_id, event_type, message, metadata)
    values (
      new.id,
      'mission_wake_advanced',
      'Meaningful incident update advanced the scheduled wake',
      jsonb_build_object('missionCount', advanced_count)
    );
  end if;
  return new;
end;
$$;

create trigger incidents_advance_waiting_mission
after update of severity, predicted_duration_minutes, status, last_updated_at
on public.incidents
for each row
when (
  old.severity is distinct from new.severity
  or old.predicted_duration_minutes is distinct from new.predicted_duration_minutes
  or old.status is distinct from new.status
  or old.last_updated_at is distinct from new.last_updated_at
)
execute function public.advance_waiting_mission_on_incident_update();

create or replace function public.run_incident_commander_demo_stage(
  p_stage text,
  p_nonce uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  demo_incident_id uuid;
  traffic_event_id uuid;
  transit_event_id uuid;
  weather_event_id uuid;
  traffic_external_id text := format('incident-commander-traffic-%s', p_nonce);
  transit_external_id text := format('incident-commander-transit-%s', p_nonce);
  weather_external_id text := format('incident-commander-weather-%s', p_nonce);
  traffic_payload jsonb;
  transit_payload jsonb;
  weather_payload jsonb;
begin
  if p_stage not in ('initial', 'escalation', 'recovery', 'final') then
    raise exception 'unsupported Incident Commander demo stage %', p_stage;
  end if;

  select events.id, links.incident_id
  into traffic_event_id, demo_incident_id
  from public.raw_events events
  left join public.incident_events links
    on links.raw_event_id = events.id and links.relationship_type = 'primary'
  where events.source = 'austin_traffic'
    and events.external_id = traffic_external_id
  limit 1;

  if demo_incident_id is not null and exists (
    select 1
    from public.agent_timeline timeline
    where timeline.incident_id = demo_incident_id
      and timeline.event_type = format('incident_commander_demo_%s', p_stage)
      and timeline.metadata->>'nonce' = p_nonce::text
  ) then
    return jsonb_build_object(
      'incidentId', demo_incident_id,
      'nonce', p_nonce,
      'stage', p_stage
    );
  end if;

  if p_stage = 'initial' then
    if demo_incident_id is null then
      insert into public.incidents (
        title, summary, incident_type, status, severity, confidence,
        latitude, longitude, location_name, predicted_duration_minutes,
        started_at, first_detected_at, last_updated_at
      ) values (
        'Lane-blocking collision on North Lamar',
        'A collision blocks one northbound lane while heavy rain and Route 801 delay amplify disruption.',
        'traffic_incident',
        'active',
        3,
        0.86,
        30.2884,
        -97.7417,
        'N LAMAR BLVD / W 24TH ST',
        24,
        now() - interval '40 minutes',
        now(),
        now()
      ) returning id into demo_incident_id;

      traffic_payload := jsonb_build_object(
        'address', 'N LAMAR BLVD / W 24TH ST',
        'issue_reported', 'COLLISION - ONE NORTHBOUND LANE BLOCKED',
        'latitude', 30.2884,
        'longitude', -97.7417,
        'blocked_lanes', 1,
        'severity_score', 3,
        'status', 'ACTIVE'
      );
      transit_payload := jsonb_build_object(
        'route_id', '801',
        'route_ids', jsonb_build_array('801'),
        'description', 'Rapid 801 operating five minutes behind schedule near North Lamar.',
        'transit_delay_minutes', 5,
        'latitude', 30.2888,
        'longitude', -97.7420,
        'status', 'ACTIVE'
      );
      weather_payload := jsonb_build_object(
        'headline', 'Heavy rain near Central Austin',
        'description', 'Heavy rainfall is reducing visibility near North Lamar Boulevard.',
        'precipitation', 'heavy',
        'latitude', 30.29,
        'longitude', -97.74,
        'status', 'ACTIVE'
      );

      insert into public.raw_events (
        source, external_id, event_type, payload, fingerprint, revision,
        source_created_at, source_updated_at, processing_status, security_status
      ) values (
        'austin_traffic', traffic_external_id, 'traffic_incident', traffic_payload,
        encode(extensions.digest(traffic_payload::text, 'sha256'), 'hex'), 1,
        now(), now(), 'active', 'passed'
      ) returning id into traffic_event_id;

      insert into public.raw_events (
        source, external_id, event_type, payload, fingerprint, revision,
        source_created_at, source_updated_at, processing_status, security_status
      ) values (
        'capmetro', transit_external_id, 'transit_delay', transit_payload,
        encode(extensions.digest(transit_payload::text, 'sha256'), 'hex'), 1,
        now(), now(), 'active', 'passed'
      ) returning id into transit_event_id;

      insert into public.raw_events (
        source, external_id, event_type, payload, fingerprint, revision,
        source_created_at, source_updated_at, processing_status, security_status
      ) values (
        'noaa_weather', weather_external_id, 'weather_alert', weather_payload,
        encode(extensions.digest(weather_payload::text, 'sha256'), 'hex'), 1,
        now(), now(), 'active', 'passed'
      ) returning id into weather_event_id;

      insert into public.incident_events (incident_id, raw_event_id, relationship_type)
      values
        (demo_incident_id, traffic_event_id, 'primary'),
        (demo_incident_id, transit_event_id, 'correlated'),
        (demo_incident_id, weather_event_id, 'correlated');
    end if;
  else
    if demo_incident_id is null then
      raise exception 'initial Incident Commander demo stage has not run for nonce %', p_nonce;
    end if;
    select id into transit_event_id from public.raw_events
    where source = 'capmetro' and external_id = transit_external_id;
    select id into weather_event_id from public.raw_events
    where source = 'noaa_weather' and external_id = weather_external_id;

    if p_stage = 'escalation' then
      update public.raw_events
      set payload = payload || jsonb_build_object(
            'issue_reported', 'COLLISION - TWO NORTHBOUND LANES BLOCKED',
            'blocked_lanes', 2,
            'severity_score', 5
          ),
          fingerprint = encode(extensions.digest((payload || jsonb_build_object(
            'issue_reported', 'COLLISION - TWO NORTHBOUND LANES BLOCKED',
            'blocked_lanes', 2,
            'severity_score', 5
          ))::text, 'sha256'), 'hex'),
          revision = revision + 1,
          source_updated_at = now(),
          last_seen_at = now()
      where id = traffic_event_id;

      update public.raw_events
      set payload = payload || jsonb_build_object(
            'description', 'Rapid 801 delay increased to fourteen minutes near North Lamar.',
            'transit_delay_minutes', 14
          ),
          fingerprint = encode(extensions.digest((payload || jsonb_build_object(
            'description', 'Rapid 801 delay increased to fourteen minutes near North Lamar.',
            'transit_delay_minutes', 14
          ))::text, 'sha256'), 'hex'),
          revision = revision + 1,
          source_updated_at = now(),
          last_seen_at = now()
      where id = transit_event_id;

      update public.incidents
      set summary = 'Two lanes are blocked and Rapid 801 delay has increased to fourteen minutes in heavy rain.',
          severity = 5,
          predicted_duration_minutes = 43,
          last_updated_at = now()
      where id = demo_incident_id;
    elsif p_stage = 'recovery' then
      update public.raw_events
      set payload = payload || jsonb_build_object(
            'issue_reported', 'NORTH LAMAR LANES REOPENED',
            'blocked_lanes', 0,
            'severity_score', 2,
            'status', 'MONITORING',
            'actual_duration_minutes', 40
          ),
          fingerprint = encode(extensions.digest((payload || jsonb_build_object(
            'blocked_lanes', 0, 'severity_score', 2, 'actual_duration_minutes', 40
          ))::text, 'sha256'), 'hex'),
          revision = revision + 1,
          source_updated_at = now(),
          last_seen_at = now()
      where id = traffic_event_id;

      update public.raw_events
      set payload = payload || jsonb_build_object(
            'description', 'Rapid 801 delay dropped to two minutes.',
            'transit_delay_minutes', 2,
            'status', 'MONITORING'
          ),
          revision = revision + 1,
          source_updated_at = now(),
          last_seen_at = now()
      where id = transit_event_id;

      update public.raw_events
      set payload = payload || jsonb_build_object(
            'headline', 'Rain weakening near Central Austin',
            'description', 'Light rain is weakening near North Lamar Boulevard.',
            'precipitation', 'light'
          ),
          revision = revision + 1,
          source_updated_at = now(),
          last_seen_at = now()
      where id = weather_event_id;

      update public.incidents
      set summary = 'Lanes have reopened, Route 801 delay is falling, and rain is weakening.',
          severity = 2,
          last_updated_at = now()
      where id = demo_incident_id;
    else
      update public.raw_events
      set payload = payload || jsonb_build_object(
            'clearance_confirmed', true,
            'status', 'CLEARED',
            'actual_duration_minutes', 40
          ),
          revision = revision + 1,
          source_updated_at = now(),
          last_seen_at = now()
      where id = traffic_event_id;

      update public.incidents
      set summary = 'Final monitoring confirms normal lane flow, nominal transit delay, and weakening rain.',
          last_updated_at = now()
      where id = demo_incident_id;
    end if;
  end if;

  insert into public.agent_timeline (incident_id, event_type, message, metadata)
  values (
    demo_incident_id,
    format('incident_commander_demo_%s', p_stage),
    case p_stage
      when 'initial' then 'Demo replay: lane-blocking collision, Route 801 delay, and heavy rain'
      when 'escalation' then 'Demo replay: second lane blocked and Route 801 delay increased'
      when 'recovery' then 'Demo replay: lanes reopened, transit delay dropped, and rain weakened'
      else 'Demo replay: final recovery cycle confirmed'
    end,
    jsonb_build_object('nonce', p_nonce, 'stage', p_stage)
  );

  return jsonb_build_object(
    'incidentId', demo_incident_id,
    'nonce', p_nonce,
    'stage', p_stage
  );
end;
$$;

revoke all on function public.run_incident_commander_demo_stage(text, uuid)
from public, anon, authenticated;
grant execute on function public.run_incident_commander_demo_stage(text, uuid)
to service_role;
