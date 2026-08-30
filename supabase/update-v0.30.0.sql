alter table public.hadas_requests
  add column if not exists manager_preapproved boolean not null default false,
  add column if not exists application_snapshot jsonb;

create table if not exists public.hadas_schedule_issue_approvals (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  issue_key text not null,
  issue_snapshot jsonb not null,
  approved_by uuid not null references public.hadas_employees(id),
  approved_at timestamptz not null default now(),
  unique (week_start, issue_key)
);

alter table public.hadas_schedule_issue_approvals enable row level security;
revoke all on table public.hadas_schedule_issue_approvals from public, anon, authenticated;
grant select, insert, update, delete on table public.hadas_schedule_issue_approvals to service_role;
create index if not exists hadas_schedule_issue_approvals_week_idx
  on public.hadas_schedule_issue_approvals(week_start, approved_at desc);

create or replace function public.hadas_apply_approved_request(p_request_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.hadas_requests%rowtype;
  first_shift public.hadas_shifts%rowtype;
  first_after public.hadas_shifts%rowtype;
  affected_shift public.hadas_shifts%rowtype;
  v_end_date date;
  v_week_start date;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
begin
  select * into r from public.hadas_requests where id=p_request_id for update;
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status <> 'approved' then raise exception 'יש לאשר את הבקשה לפני הזרמתה'; end if;
  v_end_date := coalesce(r.request_end_date, r.request_date);

  if r.request_type in ('leave','day_off','sick') then
    for affected_shift in
      select * from public.hadas_shifts
      where employee_id=r.requester_id
        and shift_date between r.request_date and v_end_date
      order by shift_date, start_time
      for update
    loop
      v_before := v_before || jsonb_build_array(to_jsonb(affected_shift));
      insert into public.hadas_schedule_changes(week_start,shift_id,change_type,before_data,after_data,created_by)
      values(affected_shift.shift_date-extract(dow from affected_shift.shift_date)::integer,affected_shift.id,'delete',to_jsonb(affected_shift),null,p_actor_id);
      delete from public.hadas_shifts where id=affected_shift.id;
    end loop;

  elsif r.request_type in ('late_start','early_finish') then
    if r.shift_id is null then raise exception 'לא נבחר שיבוץ לעדכון'; end if;
    select * into first_shift from public.hadas_shifts where id=r.shift_id for update;
    if not found or first_shift.employee_id <> r.requester_id then raise exception 'השיבוץ השתנה או נמחק מאז הגשת הבקשה'; end if;
    v_before := jsonb_build_array(to_jsonb(first_shift));
    if r.request_type='late_start' then
      if r.requested_start is null or r.requested_start <= first_shift.start_time or r.requested_start >= first_shift.end_time then raise exception 'שעת ההתחלה המבוקשת אינה מתאימה עוד לשיבוץ'; end if;
      update public.hadas_shifts set start_time=r.requested_start,status='draft' where id=first_shift.id returning * into first_after;
    else
      if r.requested_end is null or r.requested_end >= first_shift.end_time or r.requested_end <= first_shift.start_time then raise exception 'שעת הסיום המבוקשת אינה מתאימה עוד לשיבוץ'; end if;
      update public.hadas_shifts set end_time=r.requested_end,status='draft' where id=first_shift.id returning * into first_after;
    end if;
    v_after := jsonb_build_array(to_jsonb(first_after));
    insert into public.hadas_schedule_changes(week_start,shift_id,change_type,before_data,after_data,created_by)
    values(first_shift.shift_date-extract(dow from first_shift.shift_date)::integer,first_shift.id,'update',to_jsonb(first_shift),to_jsonb(first_after),p_actor_id);

  elsif r.request_type='swap' then
    if r.target_approved is not true then raise exception 'העובד שנבחר עדיין לא אישר את ההחלפה'; end if;
    if r.target_employee_id is null or r.target_employee_id=r.requester_id then raise exception 'פרטי ההחלפה אינם תקינים'; end if;
    if not exists(select 1 from public.hadas_employees e where e.id=r.target_employee_id and e.active=true and e.is_schedulable=true) then raise exception 'העובד שנבחר אינו זמין לשיבוץ'; end if;
    if exists(select 1 from public.hadas_shifts s where s.employee_id=r.target_employee_id and s.shift_date=r.request_date) then raise exception 'העובד שנבחר כבר משובץ ביום זה'; end if;
    if not (
      exists(select 1 from public.hadas_employee_weekly_patterns p where p.employee_id=r.target_employee_id and p.weekday=extract(dow from r.request_date)::integer and p.day_type='day_off')
      or exists(select 1 from public.hadas_requests q where q.requester_id=r.target_employee_id and q.request_type='day_off' and q.status in ('approved','applied') and r.request_date between q.request_date and coalesce(q.request_end_date,q.request_date))
      or exists(select 1 from public.hadas_employees e where e.id=r.target_employee_id and e.fixed_day_off=extract(dow from r.request_date)::integer and not exists(select 1 from public.hadas_employee_weekly_patterns p2 where p2.employee_id=e.id and p2.weekday=extract(dow from r.request_date)::integer))
    ) then raise exception 'ניתן לבחור להחלפה רק עובד שנמצא ביום חופשי'; end if;
    if not exists(select 1 from public.hadas_shifts s where s.employee_id=r.requester_id and s.shift_date=r.request_date) then raise exception 'למבקש אין שיבוץ ביום שנבחר'; end if;
    for affected_shift in
      select * from public.hadas_shifts where employee_id=r.requester_id and shift_date=r.request_date order by start_time for update
    loop
      if exists(select 1 from public.hadas_employee_class_constraints c where c.employee_id=r.target_employee_id and c.class_id=affected_shift.class_id and c.constraint_type='forbidden' and (c.valid_from is null or c.valid_from<=affected_shift.shift_date) and (c.valid_to is null or c.valid_to>=affected_shift.shift_date)) then raise exception 'ההחלפה מפרה אילוץ כיתה של העובד שנבחר'; end if;
      v_before := v_before || jsonb_build_array(to_jsonb(affected_shift));
      perform set_config('app.swap_mode','on',true);
      update public.hadas_shifts set employee_id=r.target_employee_id,status='draft' where id=affected_shift.id returning * into first_after;
      v_after := v_after || jsonb_build_array(to_jsonb(first_after));
      v_week_start := affected_shift.shift_date-extract(dow from affected_shift.shift_date)::integer;
      insert into public.hadas_schedule_changes(week_start,shift_id,change_type,before_data,after_data,created_by)
      values(v_week_start,affected_shift.id,'update',to_jsonb(affected_shift),to_jsonb(first_after),p_actor_id);
    end loop;
  else
    raise exception 'סוג הבקשה אינו נתמך להזרמה';
  end if;

  update public.hadas_requests set
    status='applied',decided_by=p_actor_id,decided_at=now(),updated_at=now(),
    application_snapshot=jsonb_build_object('request_type',r.request_type,'before_shifts',v_before,'after_shifts',v_after,'applied_at',now())
  where id=p_request_id;
end;
$function$;

create or replace function public.hadas_delete_request_v030(p_request_id uuid,p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.hadas_requests%rowtype;
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_before_row jsonb;
  v_after_row jsonb;
  v_current public.hadas_shifts%rowtype;
  v_restored public.hadas_shifts%rowtype;
  v_shift_id uuid;
  v_week_start date;
  v_restored_count integer := 0;
begin
  select * into r from public.hadas_requests where id=p_request_id for update;
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status not in ('approved','applied') then raise exception 'ניתן למחוק רק בקשה שאושרה או הוזרמה'; end if;

  if r.status='applied' then
    v_snapshot := coalesce(r.application_snapshot,'{}'::jsonb);
    v_before := coalesce(v_snapshot->'before_shifts','[]'::jsonb);
    v_after := coalesce(v_snapshot->'after_shifts','[]'::jsonb);
    if r.request_type in ('leave','day_off','sick') then
      for v_before_row in select value from jsonb_array_elements(v_before)
      loop
        v_shift_id := (v_before_row->>'id')::uuid;
        if exists(select 1 from public.hadas_shifts where id=v_shift_id) then raise exception 'לא ניתן לבטל את הבקשה: שיבוץ מקורי כבר קיים מחדש. יש לבדוק את השיבוץ ידנית.'; end if;
        if exists(select 1 from public.hadas_shifts s where s.employee_id=(v_before_row->>'employee_id')::uuid and s.shift_date=(v_before_row->>'shift_date')::date and s.start_time<(v_before_row->>'end_time')::time and s.end_time>(v_before_row->>'start_time')::time) then raise exception 'לא ניתן לבטל את הבקשה כי נוסף לעובד שיבוץ חופף מאז ההזרמה. יש לתקן את השיבוץ ידנית.'; end if;
        insert into public.hadas_shifts(id,shift_date,class_id,employee_id,start_time,end_time,shift_role,status,public_note,created_by,created_at,updated_at,rule_override,rule_override_note)
        values(v_shift_id,(v_before_row->>'shift_date')::date,(v_before_row->>'class_id')::uuid,(v_before_row->>'employee_id')::uuid,(v_before_row->>'start_time')::time,(v_before_row->>'end_time')::time,coalesce(v_before_row->>'shift_role','staff'),'draft',nullif(v_before_row->>'public_note',''),nullif(v_before_row->>'created_by','')::uuid,coalesce(nullif(v_before_row->>'created_at','')::timestamptz,now()),now(),coalesce((v_before_row->>'rule_override')::boolean,false),nullif(v_before_row->>'rule_override_note','')) returning * into v_restored;
        v_week_start := v_restored.shift_date-extract(dow from v_restored.shift_date)::integer;
        insert into public.hadas_schedule_changes(week_start,shift_id,change_type,before_data,after_data,created_by) values(v_week_start,v_restored.id,'create',null,to_jsonb(v_restored),p_actor_id);
        v_restored_count := v_restored_count+1;
      end loop;
    else
      for v_before_row in select value from jsonb_array_elements(v_before)
      loop
        v_shift_id := (v_before_row->>'id')::uuid;
        select value into v_after_row from jsonb_array_elements(v_after) where value->>'id'=v_shift_id::text limit 1;
        if v_after_row is null then raise exception 'לא ניתן לבטל את הבקשה: חסרה תמונת השיבוץ לאחר ההזרמה.'; end if;
        select * into v_current from public.hadas_shifts where id=v_shift_id for update;
        if not found then raise exception 'לא ניתן לבטל את הבקשה כי השיבוץ שהשתנה בעקבותיה כבר נמחק.'; end if;
        if v_current.shift_date is distinct from (v_after_row->>'shift_date')::date or v_current.class_id is distinct from (v_after_row->>'class_id')::uuid or v_current.employee_id is distinct from (v_after_row->>'employee_id')::uuid or v_current.start_time is distinct from (v_after_row->>'start_time')::time or v_current.end_time is distinct from (v_after_row->>'end_time')::time then raise exception 'לא ניתן לבטל את הבקשה אוטומטית כי השיבוץ נערך מאז ההזרמה. יש לבטל את השינוי ידנית.'; end if;
        update public.hadas_shifts set shift_date=(v_before_row->>'shift_date')::date,class_id=(v_before_row->>'class_id')::uuid,employee_id=(v_before_row->>'employee_id')::uuid,start_time=(v_before_row->>'start_time')::time,end_time=(v_before_row->>'end_time')::time,shift_role=coalesce(v_before_row->>'shift_role','staff'),status='draft',public_note=nullif(v_before_row->>'public_note',''),rule_override=coalesce((v_before_row->>'rule_override')::boolean,false),rule_override_note=nullif(v_before_row->>'rule_override_note',''),updated_at=now() where id=v_shift_id returning * into v_restored;
        v_week_start := v_restored.shift_date-extract(dow from v_restored.shift_date)::integer;
        insert into public.hadas_schedule_changes(week_start,shift_id,change_type,before_data,after_data,created_by) values(v_week_start,v_shift_id,'update',to_jsonb(v_current),to_jsonb(v_restored),p_actor_id);
        v_restored_count := v_restored_count+1;
      end loop;
    end if;
  end if;

  delete from public.hadas_request_messages where request_id=r.id;
  delete from public.hadas_notifications where entity_type='request' and entity_id=r.id::text;
  delete from public.hadas_requests where id=r.id;
  return jsonb_build_object('id',r.id,'requester_id',r.requester_id,'request_type',r.request_type,'request_date',r.request_date,'request_end_date',r.request_end_date,'attachment_path',r.attachment_path,'status',r.status,'restored_shifts',v_restored_count);
end;
$function$;

revoke all on function public.hadas_apply_approved_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hadas_apply_approved_request(uuid,uuid) to service_role;
revoke all on function public.hadas_delete_request_v030(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hadas_delete_request_v030(uuid,uuid) to service_role;

update public.hadas_app_meta set schema_version='0.30.0',app_version='0.30.0',updated_at=now() where id=1;
