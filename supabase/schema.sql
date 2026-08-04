-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.12.0 (סכמת נתונים 0.12.0)
-- אין שימוש ב-Supabase Auth. ההתחברות מתבצעת בשרת Vercel באמצעות טלפון + סיסמה מוצפנת.
-- התקנה נקייה ויציבה לגרסת ההקמה הראשונית.
-- הקובץ מוחק ומקים מחדש רק אובייקטים שמתחילים ב-hadas_.
-- הוא אינו נוגע בטבלאות או בנתונים של מערכת אופקים או של פרויקטים אחרים.

-- הסרה בטוחה מה-publication לפני מחיקת טבלת האותות.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='hadas_realtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.hadas_realtime_events;
  END IF;
END $$;

-- ניקוי התקנות חלקיות או גרסאות קודמות של מערכת הדס בלבד.
DROP TABLE IF EXISTS
  public.hadas_notifications,
  public.hadas_announcement_recipients,
  public.hadas_announcement_reads,
  public.hadas_task_assignees,
  public.hadas_attendance,
  public.hadas_daily_operations,
  public.hadas_schedule_acknowledgements,
  public.hadas_schedule_changes,
  public.hadas_schedule_publications,
  public.hadas_requests,
  public.hadas_shifts,
  public.hadas_employee_weekly_patterns,
  public.hadas_employee_class_constraints,
  public.hadas_employee_private,
  public.hadas_sessions,
  public.hadas_login_security,
  public.hadas_users,
  public.hadas_documents,
  public.hadas_calendar_events,
  public.hadas_tasks,
  public.hadas_announcements,
  public.hadas_realtime_events,
  public.hadas_audit_log,
  public.hadas_app_settings,
  public.hadas_app_meta,
  public.hadas_employees,
  public.hadas_profiles,
  public.hadas_classes
CASCADE;

DROP FUNCTION IF EXISTS public.hadas_apply_approved_request(uuid,uuid) CASCADE;
DROP FUNCTION IF EXISTS public.hadas_apply_shift_swap(uuid,uuid) CASCADE;
DROP FUNCTION IF EXISTS public.hadas_emit_realtime_event() CASCADE;
DROP FUNCTION IF EXISTS public.hadas_prevent_shift_overlap() CASCADE;
DROP FUNCTION IF EXISTS public.hadas_set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.hadas_audit_changes() CASCADE;
DROP FUNCTION IF EXISTS public.hadas_is_active_user() CASCADE;
DROP FUNCTION IF EXISTS public.hadas_is_manager() CASCADE;

create table if not exists public.hadas_app_meta (
  id integer primary key default 1 check (id = 1),
  schema_version text not null,
  app_version text not null,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.hadas_app_meta(id, schema_version, app_version)
values (1, '0.12.0', '0.12.0')
on conflict (id) do update set schema_version=excluded.schema_version, app_version=excluded.app_version, updated_at=now();

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
  job_title text not null default 'סייעת/ סייע',
  primary_class_id uuid references public.hadas_classes(id) on delete set null,
  can_lead boolean not null default false,
  weekly_hours numeric(5,2),
  max_weekly_hours numeric(5,2) check (max_weekly_hours is null or (max_weekly_hours >= 0 and max_weekly_hours <= 80)),
  employment_percent numeric(5,2),
  assignment_mode text not null default 'fixed' check (assignment_mode in ('fixed','rotation','substitute','no_schedule')),
  is_schedulable boolean not null default true,
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
alter table public.hadas_employees add column if not exists max_weekly_hours numeric(5,2);
alter table public.hadas_employees add column if not exists employment_percent numeric(5,2);
alter table public.hadas_employees add column if not exists assignment_mode text not null default 'fixed';
alter table public.hadas_employees add column if not exists is_schedulable boolean not null default true;
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

create table if not exists public.hadas_employee_weekly_patterns (
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  day_type text not null check (day_type in ('work','day_off','as_needed')),
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (employee_id, weekday),
  check (
    (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
    or
    (day_type='work' and start_time is not null and end_time is not null and end_time > start_time)
  )
);
create index if not exists hadas_weekly_patterns_weekday_idx on public.hadas_employee_weekly_patterns(weekday, day_type);

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
  status text not null default 'draft' check (status in ('draft','published')),
  public_note text,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists hadas_shifts_date_idx on public.hadas_shifts(shift_date);
create index if not exists hadas_shifts_employee_date_idx on public.hadas_shifts(employee_id, shift_date);
create index if not exists hadas_shifts_class_date_idx on public.hadas_shifts(class_id, shift_date);


create table if not exists public.hadas_schedule_publications (
  week_start date primary key,
  revision integer not null default 0,
  published_at timestamptz,
  published_by uuid references public.hadas_employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_schedule_changes (
  id bigserial primary key,
  week_start date not null,
  shift_id uuid,
  change_type text not null check (change_type in ('create','update','delete','copy')),
  before_data jsonb,
  after_data jsonb,
  created_by uuid references public.hadas_employees(id) on delete set null,
  published_revision integer,
  created_at timestamptz not null default now()
);
create index if not exists hadas_schedule_changes_week_idx on public.hadas_schedule_changes(week_start, published_revision, created_at);

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

create index if not exists hadas_attendance_date_status_idx on public.hadas_attendance(attendance_date,status,employee_id);

create table if not exists public.hadas_daily_operations (
  id uuid primary key default gen_random_uuid(),
  operation_date date not null,
  shift_id uuid references public.hadas_shifts(id) on delete set null,
  employee_id uuid not null references public.hadas_employees(id) on delete restrict,
  class_id uuid not null references public.hadas_classes(id) on delete restrict,
  operation_type text not null check (operation_type in ('sick','absent','late','early_release','other')),
  source text not null default 'manual' check (source in ('manual','attendance')),
  start_time time,
  end_time time,
  note text,
  replacement_employee_id uuid references public.hadas_employees(id) on delete set null,
  replacement_from_class_id uuid references public.hadas_classes(id) on delete set null,
  replacement_type text check (replacement_type is null or replacement_type in ('replacement','transfer')),
  replacement_start time,
  replacement_end time,
  status text not null default 'open' check (status in ('open','resolved')),
  created_by uuid references public.hadas_employees(id) on delete set null,
  resolved_by uuid references public.hadas_employees(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hadas_daily_operations_date_idx on public.hadas_daily_operations(operation_date,class_id,status);
create unique index if not exists hadas_daily_operations_shift_unique on public.hadas_daily_operations(shift_id,operation_date) where shift_id is not null;
create index if not exists hadas_daily_operations_employee_idx on public.hadas_daily_operations(employee_id,operation_date);
create index if not exists hadas_daily_operations_source_idx on public.hadas_daily_operations(operation_date,source,status);

create table if not exists public.hadas_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.hadas_employees(id) on delete cascade,
  request_type text not null check (request_type in ('leave','day_off','late_start','early_finish','sick','swap')),
  request_date date not null,
  request_end_date date,
  requested_start time,
  requested_end time,
  shift_id uuid references public.hadas_shifts(id) on delete set null,
  target_employee_id uuid references public.hadas_employees(id) on delete set null,
  target_shift_id uuid references public.hadas_shifts(id) on delete set null,
  target_approved boolean not null default false,
  reason text,
  attachment_path text,
  attachment_name text,
  allow_schedule_on_day_off boolean not null default false,
  attachment_type text,
  attachment_size integer,
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied','cancelled')),
  manager_note text,
  decided_by uuid references public.hadas_employees(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (request_end_date is null or request_end_date >= request_date)
);
create index if not exists hadas_requests_date_idx on public.hadas_requests(request_date);


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
create index if not exists hadas_notifications_employee_idx on public.hadas_notifications(employee_id, read_at, created_at desc);

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
  friday_closing_time time not null default '12:00',
  required_staff integer not null default 4 check (required_staff > 0),
  closing_required_staff integer not null default 3 check (closing_required_staff > 0),
  closing_window_minutes integer not null default 30 check (closing_window_minutes between 15 and 180),
  validation_slot_minutes integer not null default 30 check (validation_slot_minutes in (15,30,60)),
  require_leader boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.hadas_app_settings add column if not exists closing_window_minutes integer not null default 30;
alter table public.hadas_app_settings add column if not exists validation_slot_minutes integer not null default 30;
alter table public.hadas_app_settings add column if not exists friday_closing_time time not null default '12:00';
alter table public.hadas_app_settings add column if not exists require_leader boolean not null default true;
insert into public.hadas_app_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.hadas_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  announcement_type text not null default 'info' check (announcement_type in ('info','important','urgent')),
  audience_type text not null default 'all' check (audience_type in ('all','class','employees')),
  class_id uuid references public.hadas_classes(id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.hadas_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hadas_announcement_recipients (
  announcement_id uuid not null references public.hadas_announcements(id) on delete cascade,
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  primary key (announcement_id, employee_id)
);
create index if not exists hadas_announcement_recipients_employee_idx on public.hadas_announcement_recipients(employee_id);

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
  target_type text not null default 'all' check (target_type in ('all','class','employee','employees')),
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


-- התאמת תפקידים וסוגי שיוך לגרסה 0.11.0.
update public.hadas_employees set job_title='סייעת/ סייע' where job_title in ('סייעת','סייע','אשת צוות');
update public.hadas_employees set assignment_mode='no_schedule',is_schedulable=false,primary_class_id=null,can_lead=false where job_title in ('מנהלת מעון','מזכירה','אחות');

-- שני החשבונות הראשוניים נוצרים אוטומטית בהרצת ה-SQL.
-- אין עמוד setup, אין קוד הקמה ואין צורך ליצור משתמשים ידנית.
DO $$
DECLARE
  v_employee_id uuid;
  v_user_id uuid;
  v_odem_id uuid;
  v_initial_hash text := 'scrypt$16384$8$1$SGFkYXMyMDI2SW5pdGlhbA$9_BjY3gQuFn5SOEmFzZXXtxQyRLB5pzc8DGoXUZi0YY';
BEGIN
  SELECT id INTO v_odem_id FROM public.hadas_classes WHERE slug='odem';

  -- אילנית זאדייב — מנהלת המעון
  SELECT id INTO v_employee_id
  FROM public.hadas_employees
  WHERE contact_phone='+972544594513'
  ORDER BY created_at ASC LIMIT 1;
  IF v_employee_id IS NULL THEN
    INSERT INTO public.hadas_employees(full_name,contact_phone,job_title,can_lead,active,assignment_mode,is_schedulable,primary_class_id)
    VALUES('אילנית זאדייב','+972544594513','מנהלת מעון',false,true,'no_schedule',false,null)
    RETURNING id INTO v_employee_id;
  ELSE
    UPDATE public.hadas_employees
    SET full_name='אילנית זאדייב', contact_phone='+972544594513', job_title='מנהלת מעון', can_lead=false, assignment_mode='no_schedule', is_schedulable=false, primary_class_id=null, active=true, ended_at=null
    WHERE id=v_employee_id;
  END IF;

  SELECT id INTO v_user_id FROM public.hadas_users
  WHERE phone='+972544594513' OR employee_id=v_employee_id
  ORDER BY CASE WHEN phone='+972544594513' THEN 0 ELSE 1 END, created_at ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    INSERT INTO public.hadas_users(employee_id,phone,password_hash,role,active,must_change_password)
    VALUES(v_employee_id,'+972544594513',v_initial_hash,'admin',true,true);
  ELSE
    UPDATE public.hadas_users
    SET employee_id=v_employee_id, phone='+972544594513', role='admin', active=true
    WHERE id=v_user_id;
  END IF;

  -- לינור אברהם — גננת ואחראית שיבוץ
  v_employee_id := NULL;
  v_user_id := NULL;
  SELECT id INTO v_employee_id
  FROM public.hadas_employees
  WHERE contact_phone='+972542521780'
  ORDER BY created_at ASC LIMIT 1;
  IF v_employee_id IS NULL THEN
    INSERT INTO public.hadas_employees(full_name,contact_phone,job_title,primary_class_id,can_lead,active)
    VALUES('לינור אברהם','+972542521780','גננת',v_odem_id,true,true)
    RETURNING id INTO v_employee_id;
  ELSE
    UPDATE public.hadas_employees
    SET full_name='לינור אברהם', contact_phone='+972542521780', job_title='גננת',
        primary_class_id=coalesce(primary_class_id,v_odem_id), can_lead=true, active=true, ended_at=null
    WHERE id=v_employee_id;
  END IF;

  SELECT id INTO v_user_id FROM public.hadas_users
  WHERE phone='+972542521780' OR employee_id=v_employee_id
  ORDER BY CASE WHEN phone='+972542521780' THEN 0 ELSE 1 END, created_at ASC LIMIT 1;
  IF v_user_id IS NULL THEN
    INSERT INTO public.hadas_users(employee_id,phone,password_hash,role,active,must_change_password)
    VALUES(v_employee_id,'+972542521780',v_initial_hash,'scheduler',true,true);
  ELSE
    UPDATE public.hadas_users
    SET employee_id=v_employee_id, phone='+972542521780', role='scheduler', active=true
    WHERE id=v_user_id;
  END IF;
END $$;


insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('hadas-sick-certificates','hadas-sick-certificates',false,3145728,array['application/pdf','image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.hadas_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_app_meta','hadas_classes','hadas_employees','hadas_users','hadas_employee_private','hadas_employee_weekly_patterns','hadas_shifts',
    'hadas_schedule_publications','hadas_requests','hadas_announcements','hadas_tasks','hadas_task_assignees','hadas_calendar_events','hadas_app_settings'
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
    raise exception 'העובד כבר משובץ בשעות חופפות';
  end if;
  return new;
end;
$$;
drop trigger if exists hadas_shifts_prevent_overlap on public.hadas_shifts;
create trigger hadas_shifts_prevent_overlap before insert or update on public.hadas_shifts
for each row execute function public.hadas_prevent_shift_overlap();

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

-- תאימות לאחור לגרסאות קוד ישנות שעדיין קוראות לפונקציית ההחלפה הייעודית.
create or replace function public.hadas_apply_shift_swap(p_request_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.hadas_apply_approved_request(p_request_id,p_actor_id);
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
    'hadas_classes','hadas_employees','hadas_employee_weekly_patterns','hadas_shifts','hadas_attendance','hadas_daily_operations','hadas_requests','hadas_notifications',
    'hadas_schedule_acknowledgements','hadas_schedule_publications','hadas_schedule_changes','hadas_announcements','hadas_announcement_recipients','hadas_announcement_reads',
    'hadas_tasks','hadas_task_assignees','hadas_calendar_events','hadas_app_settings'
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
    'hadas_app_meta','hadas_classes','hadas_employees','hadas_users','hadas_sessions','hadas_login_security',
    'hadas_employee_weekly_patterns','hadas_employee_class_constraints','hadas_employee_private','hadas_shifts','hadas_attendance','hadas_daily_operations',
    'hadas_requests','hadas_notifications','hadas_schedule_acknowledgements','hadas_schedule_publications','hadas_schedule_changes','hadas_app_settings','hadas_announcements',
    'hadas_announcement_recipients','hadas_announcement_reads','hadas_tasks','hadas_task_assignees','hadas_calendar_events',
    'hadas_audit_log','hadas_realtime_events'
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

-- הרשאות שרת רק לאובייקטים של מערכת הדס, בלי לגעת בטבלאות אחרות בפרויקט.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND left(tablename, 6) = 'hadas_'
  LOOP
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', r.tablename);
  END LOOP;

  FOR r IN
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema='public' AND left(sequence_name, 6) = 'hadas_'
  LOOP
    EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO service_role', r.sequence_name);
  END LOOP;
END $$;

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
