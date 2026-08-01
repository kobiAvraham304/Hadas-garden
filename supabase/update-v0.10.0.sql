-- מערכת ניהול שיבוצים מעון הדס — עדכון 0.10.0
-- להריץ פעם אחת לאחר גרסה 0.9.0. העדכון אינו מוחק נתונים קיימים.
begin;

alter table public.hadas_requests
  add column if not exists request_end_date date,
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size integer;

alter table public.hadas_requests drop constraint if exists hadas_requests_date_range_check;
alter table public.hadas_requests add constraint hadas_requests_date_range_check
  check (request_end_date is null or request_end_date >= request_date);

create table if not exists public.hadas_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  notification_type text not null default 'info',
  title text not null,
  message text,
  entity_type text,
  entity_id text,
  action_required boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hadas_notifications_employee_idx
  on public.hadas_notifications(employee_id, read_at, created_at desc);

-- ניסוח כללי לעובדים מכל המגדרים, תוך שמירה על בדיקת החפיפה הקיימת.
create or replace function public.hadas_prevent_shift_overlap()
returns trigger language plpgsql as $$
begin
  if current_setting('app.swap_mode', true) = 'on' then return new; end if;
  if exists (
    select 1 from public.hadas_shifts s
    where s.employee_id = new.employee_id
      and s.shift_date = new.shift_date
      and s.id <> new.id
      and new.start_time < s.end_time
      and new.end_time > s.start_time
  ) then
    raise exception 'העובד כבר משובץ בשעות חופפות';
  end if;
  return new;
end;
$$;

-- אישורי מחלה נשמרים בדלי פרטי ונפתחים רק דרך שרת המערכת.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'hadas-sick-certificates',
  'hadas-sick-certificates',
  false,
  3145728,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.hadas_apply_approved_request(p_request_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  r public.hadas_requests%rowtype;
  first_shift public.hadas_shifts%rowtype;
  first_after public.hadas_shifts%rowtype;
  affected_shift public.hadas_shifts%rowtype;
  v_end_date date;
  v_week_start date;
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
      for update
    loop
      insert into public.hadas_schedule_changes(
        week_start, shift_id, change_type, before_data, after_data, created_by
      ) values (
        affected_shift.shift_date - extract(dow from affected_shift.shift_date)::integer,
        affected_shift.id,
        'delete',
        to_jsonb(affected_shift),
        null,
        p_actor_id
      );
      delete from public.hadas_shifts where id=affected_shift.id;
    end loop;

  elsif r.request_type in ('late_start','early_finish') then
    if r.shift_id is null then raise exception 'לא נבחר שיבוץ לעדכון'; end if;
    select * into first_shift from public.hadas_shifts where id=r.shift_id for update;
    if not found or first_shift.employee_id <> r.requester_id then
      raise exception 'השיבוץ השתנה או נמחק מאז הגשת הבקשה';
    end if;

    if r.request_type='late_start' then
      if r.requested_start is null or r.requested_start <= first_shift.start_time or r.requested_start >= first_shift.end_time then
        raise exception 'שעת ההתחלה המבוקשת אינה מתאימה עוד לשיבוץ';
      end if;
      update public.hadas_shifts
      set start_time=r.requested_start, status='draft'
      where id=first_shift.id returning * into first_after;
    else
      if r.requested_end is null or r.requested_end >= first_shift.end_time or r.requested_end <= first_shift.start_time then
        raise exception 'שעת הסיום המבוקשת אינה מתאימה עוד לשיבוץ';
      end if;
      update public.hadas_shifts
      set end_time=r.requested_end, status='draft'
      where id=first_shift.id returning * into first_after;
    end if;

    insert into public.hadas_schedule_changes(
      week_start, shift_id, change_type, before_data, after_data, created_by
    ) values (
      first_shift.shift_date - extract(dow from first_shift.shift_date)::integer,
      first_shift.id,
      'update',
      to_jsonb(first_shift),
      to_jsonb(first_after),
      p_actor_id
    );

  elsif r.request_type='swap' then
    if r.target_approved is not true then raise exception 'העובד שנבחר עדיין לא אישר את ההחלפה'; end if;
    if r.target_employee_id is null or r.target_employee_id=r.requester_id then
      raise exception 'פרטי ההחלפה אינם תקינים';
    end if;
    if not exists (
      select 1 from public.hadas_employees e
      where e.id=r.target_employee_id and e.active=true and e.is_schedulable=true
    ) then raise exception 'העובד שנבחר אינו זמין לשיבוץ'; end if;
    if exists (
      select 1 from public.hadas_shifts s
      where s.employee_id=r.target_employee_id and s.shift_date=r.request_date
    ) then raise exception 'העובד שנבחר כבר משובץ ביום זה'; end if;
    if not (
      exists (
        select 1 from public.hadas_employee_weekly_patterns p
        where p.employee_id=r.target_employee_id
          and p.weekday=extract(dow from r.request_date)::integer
          and p.day_type='day_off'
      )
      or exists (
        select 1 from public.hadas_requests q
        where q.requester_id=r.target_employee_id
          and q.request_type='day_off'
          and q.status in ('approved','applied')
          and r.request_date between q.request_date and coalesce(q.request_end_date,q.request_date)
      )
      or exists (
        select 1 from public.hadas_employees e
        where e.id=r.target_employee_id
          and e.fixed_day_off=extract(dow from r.request_date)::integer
          and not exists (
            select 1 from public.hadas_employee_weekly_patterns p2
            where p2.employee_id=e.id and p2.weekday=extract(dow from r.request_date)::integer
          )
      )
    ) then raise exception 'ניתן לבחור להחלפה רק עובד שנמצא ביום חופשי'; end if;
    if not exists (
      select 1 from public.hadas_shifts s
      where s.employee_id=r.requester_id and s.shift_date=r.request_date
    ) then raise exception 'למבקש אין שיבוץ ביום שנבחר'; end if;

    for affected_shift in
      select * from public.hadas_shifts
      where employee_id=r.requester_id and shift_date=r.request_date
      order by start_time
      for update
    loop
      if exists (
        select 1 from public.hadas_employee_class_constraints c
        where c.employee_id=r.target_employee_id and c.class_id=affected_shift.class_id
          and c.constraint_type='forbidden'
          and (c.valid_from is null or c.valid_from <= affected_shift.shift_date)
          and (c.valid_to is null or c.valid_to >= affected_shift.shift_date)
      ) then raise exception 'ההחלפה מפרה אילוץ כיתה של העובד שנבחר'; end if;

      perform set_config('app.swap_mode','on',true);
      update public.hadas_shifts
      set employee_id=r.target_employee_id, status='draft'
      where id=affected_shift.id
      returning * into first_after;

      v_week_start := affected_shift.shift_date - extract(dow from affected_shift.shift_date)::integer;
      insert into public.hadas_schedule_changes(
        week_start, shift_id, change_type, before_data, after_data, created_by
      ) values (
        v_week_start, affected_shift.id, 'update',
        to_jsonb(affected_shift), to_jsonb(first_after), p_actor_id
      );
    end loop;

  else
    raise exception 'סוג הבקשה אינו נתמך להזרמה';
  end if;

  update public.hadas_requests
  set status='applied', decided_by=p_actor_id, decided_at=now(), updated_at=now()
  where id=p_request_id;
end;
$$;
revoke all on function public.hadas_apply_approved_request(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hadas_apply_approved_request(uuid,uuid) to service_role;

alter table public.hadas_notifications enable row level security;
revoke all on table public.hadas_notifications from anon, authenticated;
grant all on table public.hadas_notifications to service_role;

-- שליחת אות רענון בעת שינוי עדכון אישי.
drop trigger if exists hadas_notifications_realtime on public.hadas_notifications;
create trigger hadas_notifications_realtime
after insert or update or delete on public.hadas_notifications
for each row execute function public.hadas_emit_realtime_event();

update public.hadas_app_meta
set schema_version='0.10.0', app_version='0.10.0', updated_at=now()
where id=1;

commit;
