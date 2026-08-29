-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.24.0
-- החלה אטומית של שיבוץ אוטומטי, ניקוי התראות סופיות ועדכון גרסה.

create or replace function public.hadas_apply_automatic_schedule(
  p_week_start date,
  p_selected_dates date[],
  p_rows jsonb,
  p_actor_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_result jsonb;
begin
  if p_mode not in ('rebuild','fill') then
    raise exception 'מצב השיבוץ האוטומטי אינו תקין';
  end if;
  if p_week_start is null or extract(dow from p_week_start)::integer <> 0 then
    raise exception 'תאריך תחילת השבוע אינו תקין';
  end if;
  if p_selected_dates is null or cardinality(p_selected_dates) < 1 or cardinality(p_selected_dates) > 6 then
    raise exception 'יש לבחור בין יום אחד לשישה ימים';
  end if;
  if cardinality(p_selected_dates) <> (select count(distinct selected_date) from unnest(p_selected_dates) as selected_date) then
    raise exception 'רשימת הימים כוללת כפילויות';
  end if;
  if exists (
    select 1 from unnest(p_selected_dates) as selected_date
    where selected_date is null or selected_date < p_week_start or selected_date > p_week_start + 5
  ) then
    raise exception 'נבחר תאריך שאינו שייך לשבוע';
  end if;
  if p_actor_id is null or not exists (select 1 from public.hadas_employees where id=p_actor_id and active) then
    raise exception 'המשתמש המבצע אינו פעיל';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'לא התקבלו שיבוצים להחלה';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hadas-auto-schedule:' || p_week_start::text,0));

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as candidate(shift_date date)
    where candidate.shift_date is null or not (candidate.shift_date=any(p_selected_dates))
  ) then
    raise exception 'התקבל שיבוץ מחוץ לימים שנבחרו';
  end if;

  if p_mode='rebuild' and exists (
    select 1 from public.hadas_attendance attendance
    join public.hadas_shifts shift on shift.id=attendance.shift_id
    where shift.shift_date=any(p_selected_dates)
  ) then
    raise exception 'לא ניתן לבנות מחדש יום שכבר כולל דיווחי נוכחות; ניתן להשתמש במילוי חוסרים';
  end if;
  if p_mode='rebuild' and exists (
    select 1 from public.hadas_daily_operations operation
    join public.hadas_shifts shift on shift.id=operation.shift_id
    where shift.shift_date=any(p_selected_dates)
  ) then
    raise exception 'לא ניתן לבנות מחדש יום שכבר כולל דיווח תפעולי; ניתן להשתמש במילוי חוסרים';
  end if;
  if p_mode='rebuild' and exists (
    select 1 from public.hadas_requests request
    join public.hadas_shifts shift on shift.id in (request.shift_id,request.target_shift_id)
    where shift.shift_date=any(p_selected_dates) and request.status in ('pending','approved')
  ) then
    raise exception 'לא ניתן לבנות מחדש יום שמקושר לבקשה פתוחה; יש לטפל בבקשה או להשתמש במילוי חוסרים';
  end if;

  if p_mode='rebuild' then
    with deleted as (
      delete from public.hadas_shifts
      where shift_date=any(p_selected_dates)
      returning *
    )
    insert into public.hadas_schedule_changes(
      week_start,shift_id,change_type,before_data,after_data,created_by
    )
    select p_week_start,id,'delete',to_jsonb(deleted),null,p_actor_id
    from deleted;
  end if;

  with source_rows as (
    select *
    from jsonb_to_recordset(p_rows) as row_data(
      shift_date date,
      class_id uuid,
      employee_id uuid,
      start_time time,
      end_time time,
      shift_role text,
      public_note text,
      rule_override boolean,
      rule_override_note text
    )
  ), inserted as (
    insert into public.hadas_shifts(
      shift_date,class_id,employee_id,start_time,end_time,shift_role,status,
      public_note,rule_override,rule_override_note,created_by
    )
    select
      shift_date,class_id,employee_id,start_time,end_time,shift_role,'draft',
      nullif(btrim(public_note),''),coalesce(rule_override,false),
      nullif(btrim(rule_override_note),''),p_actor_id
    from source_rows
    returning *
  ), logged as (
    insert into public.hadas_schedule_changes(
      week_start,shift_id,change_type,before_data,after_data,created_by
    )
    select p_week_start,id,'create',null,to_jsonb(inserted),p_actor_id
    from inserted
    returning id
  )
  select jsonb_build_object(
    'count',count(*),
    'inserted',coalesce(jsonb_agg(to_jsonb(inserted) order by shift_date,start_time,employee_id),'[]'::jsonb)
  )
  into v_result
  from inserted;

  insert into public.hadas_audit_log(actor_employee_id,action,entity_type,entity_id,details)
  values(
    p_actor_id,'automatic_schedule','schedule',p_week_start::text,
    jsonb_build_object('mode',p_mode,'selected_dates',to_jsonb(p_selected_dates),'generated',coalesce((v_result->>'count')::integer,0))
  );

  return coalesce(v_result,jsonb_build_object('count',0,'inserted','[]'::jsonb));
end;
$$;

revoke all on function public.hadas_apply_automatic_schedule(date,date[],jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.hadas_apply_automatic_schedule(date,date[],jsonb,uuid,text) to service_role;

-- בקשות סופיות אינן יכולות להישאר מסומנות כפעולה פתוחה.
update public.hadas_notifications notification
set action_required=false
from public.hadas_requests request
where notification.entity_type='request'
  and notification.entity_id=request.id::text
  and request.status in ('applied','rejected','cancelled')
  and notification.action_required=true;

update public.hadas_notifications
set action_required=false
where entity_type='daily_operation' and action_required=true;

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.24.0','0.24.0',now())
on conflict(id) do update
set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
