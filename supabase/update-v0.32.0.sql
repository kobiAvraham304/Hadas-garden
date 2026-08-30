-- Hadas Garden v0.32.0
-- Consolidated validation UX, faster issue approvals and atomic multi-day nursery closures.

begin;

create or replace function public.hadas_bulk_general_day_off_v032(
  p_dates date[],
  p_title text,
  p_description text,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dates date[];
  v_date date;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_shift_count integer := 0;
  v_event_count integer := 0;
begin
  select array_agg(d order by d)
  into v_dates
  from (
    select distinct unnest(coalesce(p_dates, array[]::date[])) as d
  ) x
  where d is not null;

  if coalesce(cardinality(v_dates), 0) = 0 then
    raise exception 'HADAS_CLOSURE_DATES_REQUIRED';
  end if;
  if cardinality(v_dates) > 31 then
    raise exception 'HADAS_CLOSURE_TOO_MANY_DATES';
  end if;
  if v_title = '' then
    raise exception 'HADAS_CLOSURE_TITLE_REQUIRED';
  end if;
  if p_actor is null or not exists (select 1 from public.hadas_employees where id = p_actor and active = true) then
    raise exception 'HADAS_CLOSURE_ACTOR_INVALID';
  end if;

  -- Serialize closure/schedule mutations by date so concurrent schedule changes cannot
  -- slip between the safety checks and the deletion within this transaction.
  foreach v_date in array v_dates loop
    perform pg_advisory_xact_lock(hashtext('hadas-general-day-off:' || v_date::text));
  end loop;

  if exists (
    select 1
    from public.hadas_attendance a
    join public.hadas_shifts s on s.id = a.shift_id
    where s.shift_date = any(v_dates)
  ) then
    raise exception 'HADAS_CLOSURE_ATTENDANCE';
  end if;

  if exists (
    select 1
    from public.hadas_daily_operations o
    join public.hadas_shifts s on s.id = o.shift_id
    where s.shift_date = any(v_dates)
  ) then
    raise exception 'HADAS_CLOSURE_OPERATIONS';
  end if;

  if exists (
    select 1
    from public.hadas_requests r
    join public.hadas_shifts s on s.id = r.shift_id
    where s.shift_date = any(v_dates)
      and r.status in ('pending','approved','applied')
  ) or exists (
    select 1
    from public.hadas_requests r
    join public.hadas_shifts s on s.id = r.target_shift_id
    where s.shift_date = any(v_dates)
      and r.status in ('pending','approved','applied')
  ) then
    raise exception 'HADAS_CLOSURE_REQUEST';
  end if;

  insert into public.hadas_schedule_changes(
    week_start, shift_id, change_type, before_data, after_data, created_by
  )
  select
    (s.shift_date - extract(dow from s.shift_date)::integer)::date,
    s.id,
    'delete',
    to_jsonb(s),
    null,
    p_actor
  from public.hadas_shifts s
  where s.shift_date = any(v_dates);

  get diagnostics v_shift_count = row_count;

  delete from public.hadas_shifts
  where shift_date = any(v_dates);

  insert into public.hadas_calendar_events(
    title, description, event_type, event_date, start_time, end_time,
    visibility, class_id, created_by, is_general_day_off
  )
  select
    v_title, v_description, 'holiday', d, null, null,
    'all', null, p_actor, true
  from unnest(v_dates) as x(d)
  where not exists (
    select 1
    from public.hadas_calendar_events e
    where e.event_date = d
      and e.is_general_day_off = true
  );

  get diagnostics v_event_count = row_count;

  return jsonb_build_object(
    'days', cardinality(v_dates),
    'created_events', v_event_count,
    'deleted_shifts', v_shift_count,
    'dates', to_jsonb(v_dates)
  );
end;
$$;

revoke all on function public.hadas_bulk_general_day_off_v032(date[], text, text, uuid) from public, anon, authenticated;
grant execute on function public.hadas_bulk_general_day_off_v032(date[], text, text, uuid) to service_role;

update public.hadas_app_meta
set schema_version = '0.32.0',
    app_version = '0.32.0',
    updated_at = now()
where id = 1;

commit;
