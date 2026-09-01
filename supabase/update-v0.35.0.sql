-- Hadas Garden v0.35.0
-- Atomic planned-schedule transfer with strict separation from daily operations.

begin;

create or replace function public.hadas_apply_transfer_suggestion_v035(
  p_source_shift_id uuid,
  p_target_shift_id uuid,
  p_payload jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_source public.hadas_shifts%rowtype;
  v_target public.hadas_shifts%rowtype;
  v_after public.hadas_shifts%rowtype;
  v_date date := nullif(p_payload->>'shift_date','')::date;
  v_class_id uuid := nullif(p_payload->>'class_id','')::uuid;
  v_employee_id uuid := nullif(p_payload->>'employee_id','')::uuid;
  v_start time := nullif(p_payload->>'start_time','')::time;
  v_end time := nullif(p_payload->>'end_time','')::time;
  v_role text := coalesce(nullif(p_payload->>'shift_role',''),'staff');
  v_week_start date;
begin
  if p_source_shift_id is null or p_target_shift_id is null or p_source_shift_id=p_target_shift_id then
    raise exception 'HADAS_TRANSFER_SHIFT_IDS';
  end if;
  if p_actor_id is null or not exists(
    select 1 from public.hadas_employees where id=p_actor_id and active
  ) then
    raise exception 'HADAS_TRANSFER_ACTOR';
  end if;
  if v_date is null or v_class_id is null or v_employee_id is null
     or v_start is null or v_end is null or v_end<=v_start
     or v_role not in ('teacher','lead','staff','replacement') then
    raise exception 'HADAS_TRANSFER_PAYLOAD';
  end if;

  -- Same order as the regular atomic shift save: serialize by employee/date,
  -- then lock both rows in stable UUID order to avoid transfer races.
  perform pg_advisory_xact_lock(
    hashtextextended('hadas-shift:' || v_employee_id::text || ':' || v_date::text,0)
  );
  perform 1
  from public.hadas_shifts
  where id in (p_source_shift_id,p_target_shift_id)
  order by id
  for update;

  select * into v_source from public.hadas_shifts where id=p_source_shift_id;
  select * into v_target from public.hadas_shifts where id=p_target_shift_id;
  if v_source.id is null or v_target.id is null then
    raise exception 'HADAS_TRANSFER_STALE';
  end if;
  if v_source.employee_id<>v_employee_id
     or v_source.shift_date<>v_date
     or v_source.start_time<>v_start
     or v_source.end_time<>v_end
     or v_target.shift_date<>v_date
     or v_target.start_time<>v_start
     or v_target.end_time<>v_end
     or v_target.class_id<>v_class_id
     or v_source.class_id=v_class_id then
    raise exception 'HADAS_TRANSFER_STALE';
  end if;
  if not exists(
    select 1 from public.hadas_employees
    where id=v_employee_id and active and coalesce(is_schedulable,true)
  ) or not exists(
    select 1 from public.hadas_classes where id=v_class_id and active
  ) then
    raise exception 'HADAS_TRANSFER_STALE';
  end if;

  -- Planned schedule changes must never rewrite or cascade-delete actual
  -- attendance/daily-operation history.
  if exists(
    select 1 from public.hadas_attendance
    where shift_id in (p_source_shift_id,p_target_shift_id)
  ) or exists(
    select 1 from public.hadas_daily_operations
    where shift_id in (p_source_shift_id,p_target_shift_id)
  ) then
    raise exception 'HADAS_TRANSFER_OPERATIONAL_DATA';
  end if;
  if exists(
    select 1 from public.hadas_requests
    where status in ('pending','approved','applied')
      and (
        shift_id in (p_source_shift_id,p_target_shift_id)
        or target_shift_id in (p_source_shift_id,p_target_shift_id)
      )
  ) then
    raise exception 'HADAS_TRANSFER_ACTIVE_REQUEST';
  end if;
  if exists(
    select 1 from public.hadas_shifts s
    where s.employee_id=v_employee_id
      and s.shift_date=v_date
      and s.start_time<v_end
      and s.end_time>v_start
      and s.id not in (p_source_shift_id,p_target_shift_id)
  ) then
    raise exception 'HADAS_TRANSFER_OVERLAP';
  end if;

  v_week_start := v_date - extract(dow from v_date)::integer;

  delete from public.hadas_shifts where id=p_source_shift_id;
  update public.hadas_shifts
  set employee_id=v_employee_id,
      shift_role=v_role,
      status='draft',
      public_note=nullif(btrim(p_payload->>'public_note'),'')
  where id=p_target_shift_id
  returning * into v_after;

  insert into public.hadas_schedule_changes(
    week_start,shift_id,change_type,before_data,after_data,created_by
  ) values
    (v_week_start,v_source.id,'delete',to_jsonb(v_source),null,p_actor_id),
    (v_week_start,v_target.id,'update',to_jsonb(v_target),to_jsonb(v_after),p_actor_id);

  insert into public.hadas_audit_log(
    actor_employee_id,action,entity_type,entity_id,details
  ) values (
    p_actor_id,'apply_transfer_suggestion','shift',v_target.id::text,
    jsonb_build_object(
      'source_shift_id',v_source.id,
      'from_class_id',v_source.class_id,
      'to_class_id',v_after.class_id,
      'employee_id',v_after.employee_id
    )
  );

  return jsonb_build_object('shift',to_jsonb(v_after));
end;
$$;

revoke all on function public.hadas_apply_transfer_suggestion_v035(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.hadas_apply_transfer_suggestion_v035(uuid,uuid,jsonb,uuid)
  to service_role;

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.35.0','0.35.0',now())
on conflict(id) do update
set schema_version=excluded.schema_version,
    app_version=excluded.app_version,
    updated_at=now();

commit;
