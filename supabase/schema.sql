-- מערכת השיבוצים של מעון הדס — סכמת Supabase ראשונית
-- יש להריץ פעם אחת ב-Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.hadas_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.hadas_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  full_name text not null,
  role text not null default 'employee' check (role in ('admin','scheduler','employee')),
  job_title text not null default 'אשת צוות',
  primary_class_id uuid references public.hadas_classes(id) on delete set null,
  can_lead boolean not null default false,
  weekly_hours numeric(5,2),
  default_start time not null default '07:30',
  default_end time not null default '15:30',
  fixed_day_off smallint check (fixed_day_off between 0 and 6),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_employee_class_constraints (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_profiles(id) on delete cascade,
  class_id uuid not null references public.hadas_classes(id) on delete cascade,
  constraint_type text not null check (constraint_type in ('preferred','avoid','forbidden')),
  valid_from date,
  valid_to date,
  reason text,
  created_by uuid references public.hadas_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table if not exists public.hadas_employee_private (
  employee_id uuid primary key references public.hadas_profiles(id) on delete cascade,
  admin_notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  class_id uuid not null references public.hadas_classes(id) on delete restrict,
  employee_id uuid not null references public.hadas_profiles(id) on delete restrict,
  start_time time not null default '07:30',
  end_time time not null default '15:30',
  shift_role text not null default 'staff' check (shift_role in ('teacher','lead','staff','replacement')),
  status text not null default 'draft' check (status in ('draft','temporary','final')),
  public_note text,
  created_by uuid references public.hadas_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists hadas_shifts_date_idx on public.hadas_shifts(shift_date);
create index if not exists hadas_shifts_employee_date_idx on public.hadas_shifts(employee_id, shift_date);
create index if not exists hadas_shifts_class_date_idx on public.hadas_shifts(class_id, shift_date);

create table if not exists public.hadas_attendance (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references public.hadas_shifts(id) on delete cascade,
  employee_id uuid not null references public.hadas_profiles(id) on delete restrict,
  attendance_date date not null,
  actual_start time,
  actual_end time,
  status text not null default 'scheduled' check (status in ('scheduled','present','late','left_early','absent','sick','replacement')),
  note text,
  updated_by uuid references public.hadas_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (actual_end is null or actual_start is null or actual_end > actual_start)
);

create table if not exists public.hadas_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.hadas_profiles(id) on delete cascade,
  request_type text not null check (request_type in ('leave','day_off','late_start','early_finish','sick','swap','other')),
  request_date date not null,
  requested_start time,
  requested_end time,
  shift_id uuid references public.hadas_shifts(id) on delete set null,
  target_employee_id uuid references public.hadas_profiles(id) on delete set null,
  target_shift_id uuid references public.hadas_shifts(id) on delete set null,
  target_approved boolean not null default false,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied','cancelled')),
  manager_note text,
  decided_by uuid references public.hadas_profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_schedule_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_profiles(id) on delete cascade,
  week_start date not null,
  acknowledged_at timestamptz not null default now(),
  unique(employee_id, week_start)
);

create table if not exists public.hadas_app_settings (
  id integer primary key default 1 check (id = 1),
  opening_time time not null default '07:30',
  closing_time time not null default '15:30',
  required_staff integer not null default 4,
  closing_required_staff integer not null default 3,
  updated_at timestamptz not null default now()
);

insert into public.hadas_app_settings(id) values (1)
on conflict (id) do nothing;

insert into public.hadas_classes(name, slug, sort_order) values
  ('סיני', 'sinai', 1),
  ('אודם', 'odem', 2),
  ('גלבוע', 'gilboa', 3)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

create table if not exists public.hadas_audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id text,
  action text not null,
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.hadas_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.hadas_audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hadas_audit_log(table_name, record_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id::text else new.id::text end,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.hadas_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hadas_profiles
    where id = auth.uid() and active = true
  );
$$;

create or replace function public.hadas_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hadas_profiles
    where id = auth.uid() and active = true and role in ('admin','scheduler')
  );
$$;

-- מניעת חפיפה של אותה עובדת באותו זמן.
create or replace function public.hadas_prevent_shift_overlap()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.swap_mode', true) = 'on' then
    return new;
  end if;
  if exists (
    select 1 from public.hadas_shifts s
    where s.employee_id = new.employee_id
      and s.shift_date = new.shift_date
      and s.id <> new.id
      and new.start_time < s.end_time
      and new.end_time > s.start_time
  ) then
    raise exception 'העובדת כבר משובצת בשעות חופפות';
  end if;
  return new;
end;
$$;



create or replace function public.hadas_apply_shift_swap(p_request_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.hadas_requests%rowtype;
  first_shift public.hadas_shifts%rowtype;
  second_shift public.hadas_shifts%rowtype;
begin
  select * into r from public.hadas_requests where id = p_request_id for update;
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if r.request_type <> 'swap' or r.status <> 'approved' or r.target_approved is not true then
    raise exception 'בקשת ההחלפה אינה מוכנה להזרמה';
  end if;

  select * into first_shift from public.hadas_shifts where id = r.shift_id for update;
  select * into second_shift from public.hadas_shifts where id = r.target_shift_id for update;
  if first_shift.id is null or second_shift.id is null then raise exception 'אחד השיבוצים אינו קיים'; end if;
  if first_shift.id = second_shift.id then raise exception 'לא ניתן להחליף שיבוץ עם עצמו'; end if;
  if first_shift.employee_id <> r.requester_id or second_shift.employee_id <> r.target_employee_id then
    raise exception 'השיבוצים השתנו מאז שליחת הבקשה';
  end if;

  if exists (
    select 1 from public.hadas_shifts s
    where s.employee_id = second_shift.employee_id
      and s.shift_date = first_shift.shift_date
      and s.id not in (first_shift.id, second_shift.id)
      and first_shift.start_time < s.end_time
      and first_shift.end_time > s.start_time
  ) or exists (
    select 1 from public.hadas_shifts s
    where s.employee_id = first_shift.employee_id
      and s.shift_date = second_shift.shift_date
      and s.id not in (first_shift.id, second_shift.id)
      and second_shift.start_time < s.end_time
      and second_shift.end_time > s.start_time
  ) then
    raise exception 'ההחלפה יוצרת חפיפה בשיבוץ';
  end if;

  if exists (
    select 1 from public.hadas_employee_class_constraints c
    where c.employee_id = second_shift.employee_id
      and c.class_id = first_shift.class_id
      and c.constraint_type = 'forbidden'
      and (c.valid_from is null or c.valid_from <= first_shift.shift_date)
      and (c.valid_to is null or c.valid_to >= first_shift.shift_date)
  ) or exists (
    select 1 from public.hadas_employee_class_constraints c
    where c.employee_id = first_shift.employee_id
      and c.class_id = second_shift.class_id
      and c.constraint_type = 'forbidden'
      and (c.valid_from is null or c.valid_from <= second_shift.shift_date)
      and (c.valid_to is null or c.valid_to >= second_shift.shift_date)
  ) then
    raise exception 'ההחלפה מפרה הגבלת כיתה';
  end if;

  perform set_config('app.swap_mode', 'on', true);
  update public.hadas_shifts
  set employee_id = case
    when id = first_shift.id then second_shift.employee_id
    when id = second_shift.id then first_shift.employee_id
    else employee_id
  end
  where id in (first_shift.id, second_shift.id);

  update public.hadas_requests
  set status = 'applied', decided_by = p_actor_id, decided_at = now(), updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.hadas_apply_shift_swap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hadas_apply_shift_swap(uuid, uuid) to service_role;

-- טריגרים

drop trigger if exists hadas_profiles_updated_at on public.hadas_profiles;
create trigger hadas_profiles_updated_at before update on public.hadas_profiles
for each row execute function public.hadas_set_updated_at();

drop trigger if exists hadas_shifts_updated_at on public.hadas_shifts;
create trigger hadas_shifts_updated_at before update on public.hadas_shifts
for each row execute function public.hadas_set_updated_at();

drop trigger if exists hadas_requests_updated_at on public.hadas_requests;
create trigger hadas_requests_updated_at before update on public.hadas_requests
for each row execute function public.hadas_set_updated_at();

drop trigger if exists hadas_employee_private_updated_at on public.hadas_employee_private;
create trigger hadas_employee_private_updated_at before update on public.hadas_employee_private
for each row execute function public.hadas_set_updated_at();

drop trigger if exists hadas_shifts_prevent_overlap on public.hadas_shifts;
create trigger hadas_shifts_prevent_overlap before insert or update on public.hadas_shifts
for each row execute function public.hadas_prevent_shift_overlap();

-- Audit

do $$
declare t text;
begin
  foreach t in array array['hadas_profiles','hadas_employee_class_constraints','hadas_shifts','hadas_attendance','hadas_requests'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.hadas_audit_changes()', t, t);
  end loop;
end $$;

-- RLS
alter table public.hadas_classes enable row level security;
alter table public.hadas_profiles enable row level security;
alter table public.hadas_employee_class_constraints enable row level security;
alter table public.hadas_employee_private enable row level security;
alter table public.hadas_shifts enable row level security;
alter table public.hadas_attendance enable row level security;
alter table public.hadas_requests enable row level security;
alter table public.hadas_schedule_acknowledgements enable row level security;
alter table public.hadas_app_settings enable row level security;
alter table public.hadas_audit_log enable row level security;

-- ניקוי מדיניות קודמת בשמות של גרסה זו

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
    where schemaname='public' and policyname like 'hadas_%'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy hadas_classes_read on public.hadas_classes for select to authenticated
using (public.hadas_is_active_user());
create policy hadas_classes_manage on public.hadas_classes for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_profiles_read on public.hadas_profiles for select to authenticated
using (public.hadas_is_active_user());
create policy hadas_profiles_manage on public.hadas_profiles for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_constraints_manage on public.hadas_employee_class_constraints for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_private_manage on public.hadas_employee_private for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_shifts_read on public.hadas_shifts for select to authenticated
using (public.hadas_is_active_user() and (public.hadas_is_manager() or status <> 'draft'));
create policy hadas_shifts_manage on public.hadas_shifts for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_attendance_read on public.hadas_attendance for select to authenticated
using (public.hadas_is_active_user() and (public.hadas_is_manager() or employee_id = auth.uid()));
create policy hadas_attendance_manage on public.hadas_attendance for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_requests_read on public.hadas_requests for select to authenticated
using (
  public.hadas_is_manager()
  or requester_id = auth.uid()
  or target_employee_id = auth.uid()
);
create policy hadas_requests_insert on public.hadas_requests for insert to authenticated
with check (public.hadas_is_active_user() and requester_id = auth.uid());
create policy hadas_ack_read on public.hadas_schedule_acknowledgements for select to authenticated
using (public.hadas_is_manager() or employee_id = auth.uid());
create policy hadas_ack_insert on public.hadas_schedule_acknowledgements for insert to authenticated
with check (public.hadas_is_active_user() and employee_id = auth.uid());
create policy hadas_ack_manage on public.hadas_schedule_acknowledgements for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_settings_read on public.hadas_app_settings for select to authenticated
using (public.hadas_is_active_user());
create policy hadas_settings_manage on public.hadas_app_settings for all to authenticated
using (public.hadas_is_manager()) with check (public.hadas_is_manager());

create policy hadas_audit_read on public.hadas_audit_log for select to authenticated
using (public.hadas_is_manager());

-- הרשאות בסיס ל-PostgREST
 grant usage on schema public to authenticated;
 grant select on public.hadas_classes, public.hadas_profiles, public.hadas_shifts, public.hadas_attendance, public.hadas_app_settings to authenticated;
 grant select, insert, update on public.hadas_requests to authenticated;
 grant select, insert on public.hadas_schedule_acknowledgements to authenticated;
 grant select, insert, update, delete on public.hadas_classes, public.hadas_profiles, public.hadas_employee_class_constraints,
   public.hadas_employee_private, public.hadas_shifts, public.hadas_attendance, public.hadas_requests,
   public.hadas_schedule_acknowledgements, public.hadas_app_settings to authenticated;
 grant select on public.hadas_audit_log to authenticated;
 grant usage, select on all sequences in schema public to authenticated;

-- הוספת הטבלאות ל-Realtime, רק אם עדיין אינן בפרסום.
do $$
declare t text;
begin
  foreach t in array array['hadas_profiles','hadas_shifts','hadas_attendance','hadas_requests','hadas_schedule_acknowledgements'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
