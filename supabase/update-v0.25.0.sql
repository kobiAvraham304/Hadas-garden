-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.25.0
-- שמירת שיבוץ מהירה/אטומית, איפוס שבוע בטוח ועדכון גרסה.

create or replace function public.hadas_save_shift_v025(
  p_shift_id uuid,
  p_payload jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_before public.hadas_shifts%rowtype;
  v_after public.hadas_shifts%rowtype;
  v_shift_date date;
  v_class_id uuid;
  v_employee_id uuid;
  v_start time;
  v_end time;
  v_role text;
  v_week_start date;
begin
  if p_actor_id is null or not exists (
    select 1 from public.hadas_employees where id=p_actor_id and active
  ) then
    raise exception 'המשתמש המבצע אינו פעיל';
  end if;

  v_shift_date := nullif(p_payload->>'shift_date','')::date;
  v_class_id := nullif(p_payload->>'class_id','')::uuid;
  v_employee_id := nullif(p_payload->>'employee_id','')::uuid;
  v_start := nullif(p_payload->>'start_time','')::time;
  v_end := nullif(p_payload->>'end_time','')::time;
  v_role := coalesce(nullif(p_payload->>'shift_role',''),'staff');

  if v_shift_date is null or v_class_id is null or v_employee_id is null or v_start is null or v_end is null or v_end <= v_start then
    raise exception 'פרטי השיבוץ אינם תקינים';
  end if;
  if v_role not in ('teacher','lead','staff','replacement') then
    raise exception 'תפקיד השיבוץ אינו תקין';
  end if;
  if not exists(select 1 from public.hadas_employees where id=v_employee_id and active and coalesce(is_schedulable,true)) then
    raise exception 'העובד אינו פעיל או אינו ניתן לשיבוץ';
  end if;
  if not exists(select 1 from public.hadas_classes where id=v_class_id and active) then
    raise exception 'הכיתה אינה פעילה';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hadas-shift:' || v_employee_id::text || ':' || v_shift_date::text,0));

  if p_shift_id is not null then
    select * into v_before from public.hadas_shifts where id=p_shift_id for update;
    if not found then raise exception 'השיבוץ לא נמצא'; end if;
  end if;

  if exists(
    select 1 from public.hadas_shifts s
    where s.employee_id=v_employee_id
      and s.shift_date=v_shift_date
      and s.start_time < v_end
      and s.end_time > v_start
      and (p_shift_id is null or s.id<>p_shift_id)
  ) then
    raise exception 'העובד כבר משובץ בשעות חופפות';
  end if;

  if p_shift_id is null then
    insert into public.hadas_shifts(
      shift_date,class_id,employee_id,start_time,end_time,shift_role,status,
      public_note,rule_override,rule_override_note,created_by
    ) values (
      v_shift_date,v_class_id,v_employee_id,v_start,v_end,v_role,'draft',
      nullif(btrim(p_payload->>'public_note'),''),
      coalesce((p_payload->>'rule_override')::boolean,false),
      nullif(btrim(p_payload->>'rule_override_note'),''),p_actor_id
    ) returning * into v_after;
  else
    update public.hadas_shifts
    set shift_date=v_shift_date,
        class_id=v_class_id,
        employee_id=v_employee_id,
        start_time=v_start,
        end_time=v_end,
        shift_role=v_role,
        status='draft',
        public_note=nullif(btrim(p_payload->>'public_note'),''),
        rule_override=coalesce((p_payload->>'rule_override')::boolean,false),
        rule_override_note=nullif(btrim(p_payload->>'rule_override_note'),'')
    where id=p_shift_id
    returning * into v_after;
  end if;

  v_week_start := v_after.shift_date - extract(dow from v_after.shift_date)::integer;

  insert into public.hadas_schedule_changes(
    week_start,shift_id,change_type,before_data,after_data,created_by
  ) values (
    v_week_start,v_after.id,case when p_shift_id is null then 'create' else 'update' end,
    case when p_shift_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after),p_actor_id
  );

  insert into public.hadas_audit_log(actor_employee_id,action,entity_type,entity_id,details)
  values(
    p_actor_id,case when p_shift_id is null then 'create' else 'update' end,
    'shift',v_after.id::text,p_payload
  );

  insert into public.hadas_realtime_events(topic) values('shifts');

  return jsonb_build_object('shift',to_jsonb(v_after));
end;
$$;

revoke all on function public.hadas_save_shift_v025(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.hadas_save_shift_v025(uuid,jsonb,uuid) to service_role;

create or replace function public.hadas_clear_schedule_week_v025(
  p_week_start date,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_count integer := 0;
begin
  if p_week_start is null or extract(dow from p_week_start)::integer<>0 then
    raise exception 'תאריך תחילת השבוע אינו תקין';
  end if;
  if p_actor_id is null or not exists(select 1 from public.hadas_employees where id=p_actor_id and active) then
    raise exception 'המשתמש המבצע אינו פעיל';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hadas-clear-week:' || p_week_start::text,0));

  if exists(
    select 1 from public.hadas_attendance a
    join public.hadas_shifts s on s.id=a.shift_id
    where s.shift_date between p_week_start and p_week_start+5
  ) then
    raise exception 'לא ניתן למחוק שבוע שכבר כולל דיווחי נוכחות. יש לעדכן את הדיווחים תחילה.';
  end if;
  if exists(
    select 1 from public.hadas_daily_operations o
    join public.hadas_shifts s on s.id=o.shift_id
    where s.shift_date between p_week_start and p_week_start+5
  ) then
    raise exception 'לא ניתן למחוק שבוע שכבר כולל דיווח תפעולי. יש לעדכן את הדיווחים תחילה.';
  end if;
  if exists(
    select 1 from public.hadas_requests r
    join public.hadas_shifts s on (s.id=r.shift_id or s.id=r.target_shift_id)
    where s.shift_date between p_week_start and p_week_start+5
      and r.status in ('pending','approved')
  ) then
    raise exception 'לא ניתן למחוק שבוע שמקושר לבקשה פתוחה. יש לטפל בבקשה תחילה.';
  end if;

  with deleted as (
    delete from public.hadas_shifts
    where shift_date between p_week_start and p_week_start+5
    returning *
  ), logged as (
    insert into public.hadas_schedule_changes(
      week_start,shift_id,change_type,before_data,after_data,created_by
    )
    select p_week_start,id,'delete',to_jsonb(deleted),null,p_actor_id
    from deleted
    returning id
  )
  select count(*)::integer into v_count from deleted;

  insert into public.hadas_audit_log(actor_employee_id,action,entity_type,entity_id,details)
  values(p_actor_id,'clear_week','schedule',p_week_start::text,jsonb_build_object('deleted',v_count));

  insert into public.hadas_realtime_events(topic) values('shifts');

  return jsonb_build_object('count',v_count,'week_start',p_week_start);
end;
$$;

revoke all on function public.hadas_clear_schedule_week_v025(date,uuid) from public,anon,authenticated;
grant execute on function public.hadas_clear_schedule_week_v025(date,uuid) to service_role;

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.25.0','0.25.0',now())
on conflict(id) do update
set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
