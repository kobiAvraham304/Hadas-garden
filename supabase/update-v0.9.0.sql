-- עדכון מערכת ניהול שיבוצים מעון הדס לגרסה 0.9.0
-- מיועד להתקנה קיימת של גרסה 0.8.0. אין להריץ schema.sql מחדש.

begin;

alter table public.hadas_employees add column if not exists max_weekly_hours numeric(5,2);
alter table public.hadas_employees add column if not exists assignment_mode text not null default 'fixed';
alter table public.hadas_employees add column if not exists is_schedulable boolean not null default true;

alter table public.hadas_employees drop constraint if exists hadas_employees_assignment_mode_check;
alter table public.hadas_employees add constraint hadas_employees_assignment_mode_check
  check (assignment_mode in ('fixed','rotation','no_schedule'));

alter table public.hadas_employees drop constraint if exists hadas_employees_max_weekly_hours_check;
alter table public.hadas_employees add constraint hadas_employees_max_weekly_hours_check
  check (max_weekly_hours is null or (max_weekly_hours >= 0 and max_weekly_hours <= 80));

create table if not exists public.hadas_employee_weekly_patterns (
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  day_type text not null check (day_type in ('work','day_off')),
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (employee_id, weekday),
  check (
    (day_type='day_off' and start_time is null and end_time is null)
    or
    (day_type='work' and start_time is not null and end_time is not null and end_time > start_time)
  )
);
create index if not exists hadas_weekly_patterns_weekday_idx on public.hadas_employee_weekly_patterns(weekday, day_type);

-- המרת יום החופש הישן לרשומה בטבלה החדשה, ללא יצירת הנחות לגבי שאר ימי העבודה.
insert into public.hadas_employee_weekly_patterns(employee_id, weekday, day_type)
select id, fixed_day_off, 'day_off'
from public.hadas_employees
where fixed_day_off is not null
on conflict (employee_id, weekday) do nothing;

-- התאמת תפקידי עבר נפוצים לרשימה החדשה, בלי לנחש תפקידים לא מוכרים.
update public.hadas_employees set job_title='סייעת'
where job_title in ('אשת צוות','מטפלת','מחליפה','סייעת אישית','סייעת משלימה','סייעת מחליפה');
update public.hadas_employees set job_title='סייעת מובילה'
where job_title in ('מובילה','מובילת כיתה');
update public.hadas_employees set job_title='גננת'
where job_title in ('גננת מובילה','גננת כיתה');
update public.hadas_employees set job_title='מנהלת מעון'
where job_title in ('מנהלת','מנהלת הגן');

-- אחות ומזכירה אינן חלק ממערך השיבוצים, אך נשארות משתמשות פעילות במערכת.
update public.hadas_employees
set is_schedulable=false, assignment_mode='no_schedule', primary_class_id=null, can_lead=false
where job_title in ('אחות','מזכירה');

-- תפקידי הובלה נגזרים מהתפקיד עצמו.
update public.hadas_employees
set can_lead = (job_title in ('סייעת מובילה','גננת','מנהלת מעון'));

-- Trigger updated_at לטבלה החדשה.
drop trigger if exists hadas_employee_weekly_patterns_updated_at on public.hadas_employee_weekly_patterns;
create trigger hadas_employee_weekly_patterns_updated_at
before update on public.hadas_employee_weekly_patterns
for each row execute function public.hadas_set_updated_at();

-- Realtime signal דרך טבלת האותות הקיימת.
drop trigger if exists hadas_employee_weekly_patterns_realtime on public.hadas_employee_weekly_patterns;
create trigger hadas_employee_weekly_patterns_realtime
after insert or update or delete on public.hadas_employee_weekly_patterns
for each row execute function public.hadas_emit_realtime_event();

alter table public.hadas_employee_weekly_patterns enable row level security;
revoke all on table public.hadas_employee_weekly_patterns from anon, authenticated;
grant all on table public.hadas_employee_weekly_patterns to service_role;

update public.hadas_app_meta
set schema_version='0.9.0', app_version='0.9.0', updated_at=now()
where id=1;

commit;
