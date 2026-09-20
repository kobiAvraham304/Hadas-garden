-- Backwards-compatible release: no existing requests or shifts are removed.
alter table public.hadas_requests
  add column if not exists available_fixed_day_weekdays integer[] not null default '{}',
  add column if not exists preferred_fixed_day_weekday integer,
  add column if not exists cancellation_status text check (cancellation_status in ('pending','rejected')),
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_decided_by uuid references public.hadas_employees(id),
  add column if not exists cancellation_decided_at timestamptz;
update public.hadas_requests set available_fixed_day_weekdays=array[available_fixed_day_weekday] where available_fixed_day_weekday is not null and cardinality(available_fixed_day_weekdays)=0;
CREATE OR REPLACE FUNCTION public.hadas_apply_approved_request(p_request_id uuid, p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      insert into public.hadas_schedule_changes(
        week_start, shift_id, change_type, before_data, after_data, created_by
      ) values (
        affected_shift.shift_date - extract(dow from affected_shift.shift_date)::integer,
        affected_shift.id, 'delete', to_jsonb(affected_shift), null, p_actor_id
      );
      delete from public.hadas_shifts where id=affected_shift.id;
    end loop;

  elsif r.request_type in ('late_start','early_finish') then
    if r.shift_id is null and r.request_type='early_finish' then
      -- Keep the approved constraint for future automatic/manual scheduling.
      return;
    end if;
    if r.shift_id is null then raise exception 'לא נבחר שיבוץ לעדכון'; end if;
    select * into first_shift from public.hadas_shifts where id=r.shift_id for update;
    if not found or first_shift.employee_id <> r.requester_id then
      raise exception 'השיבוץ השתנה או נמחק מאז הגשת הבקשה';
    end if;
    v_before := jsonb_build_array(to_jsonb(first_shift));

    if r.request_type='late_start' then
      if r.requested_start is null or r.requested_start <= first_shift.start_time or r.requested_start >= first_shift.end_time then
        raise exception 'שעת ההתחלה המבוקשת אינה מתאימה עוד לשיבוץ';
      end if;
      update public.hadas_shifts set start_time=r.requested_start, status='draft'
      where id=first_shift.id returning * into first_after;
    else
      if r.requested_end is null or r.requested_end >= first_shift.end_time or r.requested_end <= first_shift.start_time then
        raise exception 'שעת הסיום המבוקשת אינה מתאימה עוד לשיבוץ';
      end if;
      update public.hadas_shifts set end_time=r.requested_end, status='draft'
      where id=first_shift.id returning * into first_after;
    end if;
    v_after := jsonb_build_array(to_jsonb(first_after));

    insert into public.hadas_schedule_changes(
      week_start, shift_id, change_type, before_data, after_data, created_by
    ) values (
      first_shift.shift_date - extract(dow from first_shift.shift_date)::integer,
      first_shift.id, 'update', to_jsonb(first_shift), to_jsonb(first_after), p_actor_id
    );

  elsif r.request_type='swap' then
    if r.target_approved is not true then raise exception 'העובד שנבחר עדיין לא אישר את ההחלפה'; end if;
    if r.target_employee_id is null or r.target_employee_id=r.requester_id then raise exception 'פרטי ההחלפה אינם תקינים'; end if;
    if not exists (select 1 from public.hadas_employees e where e.id=r.target_employee_id and e.active=true and e.is_schedulable=true) then
      raise exception 'העובד שנבחר אינו זמין לשיבוץ';
    end if;
    if exists (select 1 from public.hadas_shifts s where s.employee_id=r.target_employee_id and s.shift_date=r.request_date) then
      raise exception 'העובד שנבחר כבר משובץ ביום זה';
    end if;
    if not (
      exists (select 1 from public.hadas_employee_weekly_patterns p where p.employee_id=r.target_employee_id and p.weekday=extract(dow from r.request_date)::integer and p.day_type='day_off')
      or exists (select 1 from public.hadas_requests q where q.requester_id=r.target_employee_id and q.request_type='day_off' and q.status in ('approved','applied') and r.request_date between q.request_date and coalesce(q.request_end_date,q.request_date))
      or exists (select 1 from public.hadas_employees e where e.id=r.target_employee_id and e.fixed_day_off=extract(dow from r.request_date)::integer and not exists (select 1 from public.hadas_employee_weekly_patterns p2 where p2.employee_id=e.id and p2.weekday=extract(dow from r.request_date)::integer))
    ) then raise exception 'ניתן לבחור להחלפה רק עובד שנמצא ביום חופשי'; end if;
    if not exists (select 1 from public.hadas_shifts s where s.employee_id=r.requester_id and s.shift_date=r.request_date) then
      raise exception 'למבקש אין שיבוץ ביום שנבחר';
    end if;

    for affected_shift in
      select * from public.hadas_shifts
      where employee_id=r.requester_id and shift_date=r.request_date
      order by start_time for update
    loop
      if exists (
        select 1 from public.hadas_employee_class_constraints c
        where c.employee_id=r.target_employee_id and c.class_id=affected_shift.class_id
          and c.constraint_type='forbidden'
          and (c.valid_from is null or c.valid_from <= affected_shift.shift_date)
          and (c.valid_to is null or c.valid_to >= affected_shift.shift_date)
      ) then raise exception 'ההחלפה מפרה אילוץ כיתה של העובד שנבחר'; end if;

      v_before := v_before || jsonb_build_array(to_jsonb(affected_shift));
      perform set_config('app.swap_mode','on',true);
      update public.hadas_shifts set employee_id=r.target_employee_id, status='draft'
      where id=affected_shift.id returning * into first_after;
      v_after := v_after || jsonb_build_array(to_jsonb(first_after));

      v_week_start := affected_shift.shift_date - extract(dow from affected_shift.shift_date)::integer;
      insert into public.hadas_schedule_changes(
        week_start, shift_id, change_type, before_data, after_data, created_by
      ) values (
        v_week_start, affected_shift.id, 'update', to_jsonb(affected_shift), to_jsonb(first_after), p_actor_id
      );
    end loop;
  else
    raise exception 'סוג הבקשה אינו נתמך להזרמה';
  end if;

  update public.hadas_requests
  set status='applied', decided_by=p_actor_id, decided_at=now(), updated_at=now(),
      application_snapshot=jsonb_build_object(
        'request_type', r.request_type,
        'before_shifts', v_before,
        'after_shifts', v_after,
        'applied_at', now()
      )
  where id=p_request_id;
end;
$function$;

revoke all on function public.hadas_apply_approved_request(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hadas_apply_approved_request(uuid,uuid) to service_role;

-- Invoked only by the server after validating the session and CSRF token.
-- Locking makes approval, deletion and cancellation mutually exclusive.
create or replace function public.hadas_leave_action_v0361(p_request_id uuid, p_actor_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.hadas_requests%rowtype; manager boolean; result jsonb;
begin
  select exists(select 1 from public.hadas_users u join public.hadas_employees e on e.id=u.employee_id
    where u.employee_id=p_actor_id and u.active and e.active and u.role in ('admin','scheduler')) into manager;
  if not exists(select 1 from public.hadas_users u join public.hadas_employees e on e.id=u.employee_id
    where u.employee_id=p_actor_id and u.active and e.active) then raise exception 'אין הרשאה'; end if;
  select * into r from public.hadas_requests where id=p_request_id for update;
  if not found then raise exception 'הבקשה לא נמצאה או כבר נמחקה'; end if;
  if r.request_type <> 'leave' then raise exception 'פעולה זו מיועדת לבקשות חופשה'; end if;
  if p_action='delete_pending' then
    if r.requester_id<>p_actor_id or r.status<>'pending' then raise exception 'ניתן למחוק רק בקשה שלך שממתינה לאישור'; end if;
    delete from public.hadas_request_messages where request_id=r.id;
    delete from public.hadas_notifications where entity_type='request' and entity_id=r.id::text;
    delete from public.hadas_requests where id=r.id;
    return jsonb_build_object('id',r.id,'requester_id',r.requester_id,'deleted',true);
  elsif p_action='request_cancellation' then
    if r.requester_id<>p_actor_id or r.status not in ('approved','applied') then raise exception 'ניתן לבקש ביטול רק לחופשה שלך שאושרה'; end if;
    if r.cancellation_status='pending' then raise exception 'בקשת הביטול כבר ממתינה לאישור'; end if;
    update public.hadas_requests set cancellation_status='pending', cancellation_requested_at=now(),
      cancellation_decided_by=null,cancellation_decided_at=null where id=r.id;
  elsif p_action in ('approve_cancellation','reject_cancellation') then
    if not manager then raise exception 'רק מנהלת המעון או אחראית השיבוץ יכולות לאשר ביטול'; end if;
    if r.cancellation_status is distinct from 'pending' or r.status not in ('approved','applied') then raise exception 'אין בקשת ביטול ממתינה'; end if;
    if p_action='approve_cancellation' then
      if exists(select 1 from public.hadas_requests q where q.id<>r.id and q.requester_id=r.requester_id
        and q.status in ('approved','applied') and q.request_type in ('leave','sick','day_off')
        and q.request_date<=coalesce(r.request_end_date,r.request_date) and coalesce(q.request_end_date,q.request_date)>=r.request_date)
        and jsonb_array_length(coalesce(r.application_snapshot->'before_shifts','[]'::jsonb))>0
        then raise exception 'קיימת היעדרות מאושרת נוספת בטווח. יש לבדוק אותה לפני החזרת השיבוץ'; end if;
      result := public.hadas_delete_request_v030(r.id,p_actor_id);
      return result || jsonb_build_object('deleted',true);
    else
      update public.hadas_requests set cancellation_status='rejected',cancellation_decided_by=p_actor_id,cancellation_decided_at=now() where id=r.id;
    end if;
  else raise exception 'פעולה לא מוכרת'; end if;
  return jsonb_build_object('id',r.id,'requester_id',r.requester_id,'deleted',false);
end; $$;
revoke all on function public.hadas_leave_action_v0361(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hadas_leave_action_v0361(uuid,uuid,text) to service_role;
