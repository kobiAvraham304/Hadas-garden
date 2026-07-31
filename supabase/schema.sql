-- מערכת השיבוצים של מעון הדס — גרסה 0.2.0
-- אין שימוש ב-Supabase Auth. ההתחברות מתבצעת בשרת Vercel באמצעות טלפון + סיסמה מוצפנת.
-- ניתן להריץ את הקובץ גם מעל סכמת 0.1.0; hadas_profiles תשונה ל-hadas_employees.

create extension if not exists pgcrypto;

-- שדרוג בטוח מגרסה 0.1.0
DO $$
BEGIN
  IF to_regclass('public.hadas_profiles') IS NOT NULL
     AND to_regclass('public.hadas_employees') IS NULL THEN
    ALTER TABLE public.hadas_profiles RENAME TO hadas_employees;
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.hadas_employees') IS NOT NULL THEN
    FOR r IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.hadas_employees'::regclass
        AND confrelid = 'auth.users'::regclass
    LOOP
      EXECUTE format('ALTER TABLE public.hadas_employees DROP CONSTRAINT %I', r.conname);
    END LOOP;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hadas_employees' AND column_name='phone')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hadas_employees' AND column_name='contact_phone') THEN
    ALTER TABLE public.hadas_employees RENAME COLUMN phone TO contact_phone;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hadas_employees' AND column_name='role') THEN
    ALTER TABLE public.hadas_employees ALTER COLUMN role DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hadas_employees' AND column_name='must_change_password') THEN
    ALTER TABLE public.hadas_employees ALTER COLUMN must_change_password DROP NOT NULL;
  END IF;
END $$;

create table if not exists public.hadas_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  contact_phone text,
  job_title text not null default 'אשת צוות',
  primary_class_id uuid references public.hadas_classes(id) on delete set null,
  can_lead boolean not null default false,
  weekly_hours numeric(5,2),
  employment_percent numeric(5,2),
  default_start time not null default '07:30',
  default_end time not null default '15:30',
  fixed_day_off smallint check (fixed_day_off between 0 and 6),
  active boolean not null default true,
  started_at date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hadas_employees add column if not exists contact_phone text;
alter table public.hadas_employees add column if not exists employment_percent numeric(5,2);
alter table public.hadas_employees add column if not exists started_at date;
alter table public.hadas_employees add column if not exists ended_at date;

create table if not exists public.hadas_users (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.hadas_employees(id) on delete cascade,
  phone text not null unique,
  password_hash text not null,
  role text not null default 'employee' check (role in ('admin','scheduler','employee')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hadas_users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists hadas_sessions_user_idx on public.hadas_sessions(user_id);
create index if not exists hadas_sessions_expiry_idx on public.hadas_sessions(expires_at) where revoked_at is null;

create table if not exists public.hadas_login_security (
  security_key text primary key,
  failed_count integer not null default 0,
  last_failed_at timestamptz,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_employee_class_constraints (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  class_id uuid not null references public.hadas_classes(id) on delete cascade,
  constraint_type text not null check (constraint_type in ('preferred','avoid','forbidden')),
  valid_from date,
  valid_to date,
  reason text,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index if not exists hadas_constraints_employee_idx on public.hadas_employee_class_constraints(employee_id);

create table if not exists public.hadas_employee_private (
  employee_id uuid primary key references public.hadas_employees(id) on delete cascade,
  admin_notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  class_id uuid not null references public.hadas_classes(id) on delete restrict,
  employee_id uuid not null references public.hadas_employees(id) on delete restrict,
  start_time time not null default '07:30',
  end_time time not null default '15:30',
  shift_role text not null default 'staff' check (shift_role in ('teacher','lead','staff','replacement')),
  status text not null default 'draft' check (status in ('draft','temporary','final')),
  public_note text,
  created_by uuid references public.hadas_employees(id) on delete set null,
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
  employee_id uuid not null references public.hadas_employees(id) on delete restrict,
  attendance_date date not null,
  actual_start time,
  actual_end time,
  status text not null default 'scheduled' check (status in ('scheduled','present','late','left_early','absent','sick','replacement')),
  note text,
  updated_by uuid references public.hadas_employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (actual_end is null or actual_start is null or actual_end > actual_start)
);

create table if not exists public.hadas_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.hadas_employees(id) on delete cascade,
  request_type text not null check (request_type in ('leave','day_off','late_start','early_finish','sick','swap','other')),
  request_date date not null,
  requested_start time,
  requested_end time,
  shift_id uuid references public.hadas_shifts(id) on delete set null,
  target_employee_id uuid references public.hadas_employees(id) on delete set null,
  target_shift_id uuid references public.hadas_shifts(id) on delete set null,
  target_approved boolean not null default false,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied','cancelled')),
  manager_note text,
  decided_by uuid references public.hadas_employees(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hadas_requests_date_idx on public.hadas_requests(request_date);

create table if not exists public.hadas_schedule_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  week_start date not null,
  acknowledged_at timestamptz not null default now(),
  unique(employee_id, week_start)
);

create table if not exists public.hadas_app_settings (
  id integer primary key default 1 check (id = 1),
  opening_time time not null default '07:30',
  closing_time time not null default '15:30',
  required_staff integer not null default 4 check (required_staff > 0),
  closing_required_staff integer not null default 3 check (closing_required_staff > 0),
  closing_window_minutes integer not null default 30 check (closing_window_minutes between 15 and 180),
  validation_slot_minutes integer not null default 30 check (validation_slot_minutes in (15,30,60)),
  updated_at timestamptz not null default now()
);
alter table public.hadas_app_settings add column if not exists closing_window_minutes integer not null default 30;
alter table public.hadas_app_settings add column if not exists validation_slot_minutes integer not null default 30;
insert into public.hadas_app_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.hadas_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  announcement_type text not null default 'info' check (announcement_type in ('info','important','urgent')),
  class_id uuid references public.hadas_classes(id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hadas_announcement_reads (
  announcement_id uuid not null references public.hadas_announcements(id) on delete cascade,
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, employee_id)
);

create table if not exists public.hadas_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_at timestamptz,
  valid_from date,
  valid_to date,
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  target_type text not null default 'all' check (target_type in ('all','class','employee')),
  target_id uuid,
  active boolean not null default true,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create table if not exists public.hadas_task_assignees (
  task_id uuid not null references public.hadas_tasks(id) on delete cascade,
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','done')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (task_id, employee_id)
);

create table if not exists public.hadas_calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text not null default 'other' check (event_type in ('holiday','meeting','training','birthday','activity','other')),
  event_date date not null,
  start_time time,
  end_time time,
  visibility text not null default 'all' check (visibility in ('all','managers','class')),
  class_id uuid references public.hadas_classes(id) on delete set null,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);
create index if not exists hadas_calendar_date_idx on public.hadas_calendar_events(event_date);

create table if not exists public.hadas_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  visibility text not null default 'all' check (visibility in ('all','managers','class')),
  class_id uuid references public.hadas_classes(id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.hadas_audit_log (
  id bigserial primary key,
  actor_employee_id uuid references public.hadas_employees(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- טבלה ציבורית שמכילה רק אות רענון ללא מידע רגיש.
create table if not exists public.hadas_realtime_events (
  id bigserial primary key,
  topic text not null default 'refresh',
  created_at timestamptz not null default now()
);

insert into public.hadas_classes(name, slug, sort_order) values
  ('סיני', 'sinai', 1),
  ('אודם', 'odem', 2),
  ('גלבוע', 'gilboa', 3)
on conflict (slug) do update set name=excluded.name, sort_order=excluded.sort_order, active=true;

create or replace function public.hadas_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_classes','hadas_employees','hadas_users','hadas_employee_private','hadas_shifts',
    'hadas_requests','hadas_announcements','hadas_tasks','hadas_task_assignees','hadas_calendar_events','hadas_app_settings'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I', t, t);
      EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.hadas_set_updated_at()', t, t);
    END IF;
  END LOOP;
END $$;

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
    raise exception 'העובדת כבר משובצת בשעות חופפות';
  end if;
  return new;
end;
$$;
drop trigger if exists hadas_shifts_prevent_overlap on public.hadas_shifts;
create trigger hadas_shifts_prevent_overlap before insert or update on public.hadas_shifts
for each row execute function public.hadas_prevent_shift_overlap();

create or replace function public.hadas_apply_shift_swap(p_request_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  r public.hadas_requests%rowtype;
  first_shift public.hadas_shifts%rowtype;
  second_shift public.hadas_shifts%rowtype;
begin
  select * into r from public.hadas_requests where id=p_request_id for update;
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if r.request_type <> 'swap' or r.status <> 'approved' or r.target_approved is not true then
    raise exception 'בקשת ההחלפה אינה מוכנה להזרמה';
  end if;
  select * into first_shift from public.hadas_shifts where id=r.shift_id for update;
  select * into second_shift from public.hadas_shifts where id=r.target_shift_id for update;
  if first_shift.id is null or second_shift.id is null then raise exception 'אחד השיבוצים אינו קיים'; end if;
  if first_shift.employee_id <> r.requester_id or second_shift.employee_id <> r.target_employee_id then
    raise exception 'השיבוצים השתנו מאז שליחת הבקשה';
  end if;
  if exists (
    select 1 from public.hadas_shifts s
    where s.employee_id=second_shift.employee_id and s.shift_date=first_shift.shift_date
      and s.id not in(first_shift.id,second_shift.id)
      and first_shift.start_time < s.end_time and first_shift.end_time > s.start_time
  ) or exists (
    select 1 from public.hadas_shifts s
    where s.employee_id=first_shift.employee_id and s.shift_date=second_shift.shift_date
      and s.id not in(first_shift.id,second_shift.id)
      and second_shift.start_time < s.end_time and second_shift.end_time > s.start_time
  ) then raise exception 'ההחלפה יוצרת חפיפה בשיבוץ'; end if;

  perform set_config('app.swap_mode','on',true);
  update public.hadas_shifts set employee_id = case
    when id=first_shift.id then second_shift.employee_id
    when id=second_shift.id then first_shift.employee_id
    else employee_id end
  where id in(first_shift.id,second_shift.id);

  update public.hadas_requests set status='applied', decided_by=p_actor_id, decided_at=now(), updated_at=now()
  where id=p_request_id;
end;
$$;
revoke all on function public.hadas_apply_shift_swap(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hadas_apply_shift_swap(uuid,uuid) to service_role;

create or replace function public.hadas_emit_realtime_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.hadas_realtime_events(topic) values (tg_table_name);
  if (select count(*) from public.hadas_realtime_events) > 2000 then
    delete from public.hadas_realtime_events
    where id in (select id from public.hadas_realtime_events order by id asc limit 500);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_classes','hadas_employees','hadas_shifts','hadas_attendance','hadas_requests',
    'hadas_schedule_acknowledgements','hadas_announcements','hadas_announcement_reads',
    'hadas_tasks','hadas_task_assignees','hadas_calendar_events','hadas_documents','hadas_app_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_realtime ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_realtime AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.hadas_emit_realtime_event()', t, t);
  END LOOP;
END $$;

-- כל המידע העסקי נעול ללקוחות. השרת בלבד משתמש ב-Secret Key ועושה הרשאות בעצמו.
DO $$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_classes','hadas_employees','hadas_users','hadas_sessions','hadas_login_security',
    'hadas_employee_class_constraints','hadas_employee_private','hadas_shifts','hadas_attendance',
    'hadas_requests','hadas_schedule_acknowledgements','hadas_app_settings','hadas_announcements',
    'hadas_announcement_reads','hadas_tasks','hadas_task_assignees','hadas_calendar_events',
    'hadas_documents','hadas_audit_log','hadas_realtime_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'hadas_%' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.hadas_realtime_events to anon, authenticated;
create policy hadas_realtime_public_read on public.hadas_realtime_events for select to anon, authenticated using (true);
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Bucket פרטי למסמכים. הורדה והעלאה רק בקישורים חתומים שנוצרים בשרת.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'hadas-documents','hadas-documents',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set public=false, file_size_limit=10485760;

-- Realtime מופעל רק על טבלת האות הציבורית.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='hadas_realtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hadas_realtime_events;
  END IF;
END $$;
