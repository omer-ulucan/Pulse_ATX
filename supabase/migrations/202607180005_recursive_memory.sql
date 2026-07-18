create index incident_memories_embedding_hnsw_idx
on public.incident_memories
using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_incident_memories(
  p_query_embedding extensions.vector(384),
  p_incident_type text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_time_bucket text default null,
  p_limit integer default 6
)
returns table(
  memory_id uuid,
  incident_id uuid,
  summary text,
  lesson jsonb,
  similarity double precision,
  combined_score double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    memories.id,
    memories.incident_id,
    memories.summary,
    memories.lesson,
    1 - (memories.embedding <=> p_query_embedding) as similarity,
    (1 - (memories.embedding <=> p_query_embedding)) * 0.70
      + case when p_incident_type is not null and incidents.incident_type = p_incident_type then 0.15 else 0 end
      + case when p_latitude is not null and p_longitude is not null
          and incidents.latitude between p_latitude - 0.08 and p_latitude + 0.08
          and incidents.longitude between p_longitude - 0.08 and p_longitude + 0.08 then 0.10 else 0 end
      + case when p_time_bucket is not null and memories.lesson->'conditions'->>'time_bucket' = p_time_bucket then 0.05 else 0 end
      as combined_score
  from public.incident_memories memories
  join public.incidents incidents on incidents.id = memories.incident_id
  where memories.embedding is not null
    and 1 - (memories.embedding <=> p_query_embedding) >= 0.45
    and (p_incident_type is null or incidents.incident_type = p_incident_type)
  order by combined_score desc
  limit greatest(1, least(p_limit, 12));
$$;

create or replace function public.record_incident_outcome(
  p_incident_id uuid,
  p_actual_duration_minutes integer,
  p_observed_severity smallint,
  p_outcome jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  source_incident public.incidents%rowtype;
  outcome_id uuid;
begin
  select * into source_incident from public.incidents where id = p_incident_id for update;
  if not found then raise exception 'incident % not found', p_incident_id; end if;

  insert into public.incident_outcomes (
    incident_id, predicted_duration_minutes, actual_duration_minutes,
    predicted_severity, observed_severity, prediction_error, outcome
  ) values (
    p_incident_id,
    source_incident.predicted_duration_minutes,
    p_actual_duration_minutes,
    source_incident.severity,
    p_observed_severity,
    abs(coalesce(source_incident.predicted_duration_minutes, p_actual_duration_minutes) - p_actual_duration_minutes),
    p_outcome
  )
  on conflict (incident_id) do update
  set actual_duration_minutes = excluded.actual_duration_minutes,
      observed_severity = excluded.observed_severity,
      prediction_error = excluded.prediction_error,
      outcome = excluded.outcome
  returning id into outcome_id;

  update public.incidents
  set status = 'resolved', actual_duration_minutes = p_actual_duration_minutes,
      ended_at = coalesce(ended_at, now()), last_updated_at = now()
  where id = p_incident_id;
  return outcome_id;
end;
$$;

create or replace function public.store_incident_memory(
  p_incident_id uuid,
  p_summary text,
  p_lesson jsonb,
  p_embedding extensions.vector(384),
  p_quality_score double precision
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  memory_id uuid;
begin
  insert into public.incident_memories (
    incident_id, summary, lesson, embedding, quality_score
  ) values (
    p_incident_id, p_summary, p_lesson, p_embedding, p_quality_score
  )
  on conflict (incident_id) do update
  set summary = excluded.summary,
      lesson = excluded.lesson,
      embedding = excluded.embedding,
      quality_score = excluded.quality_score
  returning id into memory_id;
  return memory_id;
end;
$$;

create or replace function public.list_memory_candidates(p_limit integer default 4)
returns table(incident jsonb, outcome jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    jsonb_build_object(
      'id', incidents.id,
      'title', incidents.title,
      'summary', incidents.summary,
      'incident_type', incidents.incident_type,
      'latitude', incidents.latitude,
      'longitude', incidents.longitude,
      'location_name', incidents.location_name,
      'predicted_duration_minutes', incidents.predicted_duration_minutes,
      'actual_duration_minutes', incidents.actual_duration_minutes,
      'severity', incidents.severity,
      'started_at', incidents.started_at
    ),
    jsonb_build_object(
      'actual_duration_minutes', outcomes.actual_duration_minutes,
      'observed_severity', outcomes.observed_severity,
      'prediction_error', outcomes.prediction_error,
      'outcome', outcomes.outcome
    )
  from public.incidents incidents
  join public.incident_outcomes outcomes on outcomes.incident_id = incidents.id
  where incidents.status = 'resolved'
    and not exists (
      select 1 from public.incident_memories memories where memories.incident_id = incidents.id
    )
  order by incidents.ended_at nulls last, incidents.created_at
  limit greatest(1, least(p_limit, 12));
$$;

revoke all on function public.match_incident_memories(extensions.vector, text, double precision, double precision, text, integer) from public, anon, authenticated;
revoke all on function public.record_incident_outcome(uuid, integer, smallint, jsonb) from public, anon, authenticated;
revoke all on function public.store_incident_memory(uuid, text, jsonb, extensions.vector, double precision) from public, anon, authenticated;
revoke all on function public.list_memory_candidates(integer) from public, anon, authenticated;
grant execute on function public.match_incident_memories(extensions.vector, text, double precision, double precision, text, integer) to service_role;
grant execute on function public.record_incident_outcome(uuid, integer, smallint, jsonb) to service_role;
grant execute on function public.store_incident_memory(uuid, text, jsonb, extensions.vector, double precision) to service_role;
grant execute on function public.list_memory_candidates(integer) to service_role;

create policy "dashboard reads incident outcomes"
on public.incident_outcomes
for select
to anon, authenticated
using (true);
