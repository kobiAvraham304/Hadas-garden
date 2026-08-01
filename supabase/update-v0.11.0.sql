-- מערכת ניהול שיבוצים מעון הדס — עדכון מגרסה 0.10.0 לגרסה 0.11.0
-- להריץ פעם אחת בלבד ב-Supabase SQL Editor.

begin;

alter table public.hadas_employees drop constraint if exists hadas_employees_assignment_mode_check;
alter table public.hadas_employees add constraint hadas_employees_assignment_mode_check
  check (assignment_mode in ('fixed','rotation','substitute','no_schedule'));

alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_day_type_check;
alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_check;
alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_times_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_day_type_check
  check (day_type in ('work','day_off','as_needed'));
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_times_check
  check (
    (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
    or (day_type='work' and start_time is not null and end_time is not null and end_time > start_time)
  );

alter table public.hadas_app_settings add column if not exists friday_closing_time time not null default '12:00';
alter table public.hadas_app_settings add column if not exists require_leader boolean not null default true;
alter table public.hadas_requests add column if not exists allow_schedule_on_day_off boolean not null default false;

update public.hadas_employees
set job_title='סייעת/ סייע'
where job_title in ('סייעת','סייע','אשת צוות');

update public.hadas_employees
set assignment_mode='no_schedule', is_schedulable=false, primary_class_id=null, can_lead=false
where job_title in ('מנהלת מעון','מזכירה','אחות');

create table if not exists public.hadas_daily_operations (
  id uuid primary key default gen_random_uuid(),
  operation_date date not null,
  shift_id uuid references public.hadas_shifts(id) on delete set null,
  employee_id uuid not null references public.hadas_employees(id) on delete restrict,
  class_id uuid not null references public.hadas_classes(id) on delete restrict,
  operation_type text not null check (operation_type in ('sick','absent','late','early_release','other')),
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
create index if not exists hadas_daily_operations_employee_idx on public.hadas_daily_operations(employee_id,operation_date);
create unique index if not exists hadas_daily_operations_shift_unique on public.hadas_daily_operations(shift_id,operation_date) where shift_id is not null;

alter table public.hadas_daily_operations enable row level security;
revoke all on table public.hadas_daily_operations from anon, authenticated;
grant all on table public.hadas_daily_operations to service_role;

drop trigger if exists hadas_daily_operations_updated_at on public.hadas_daily_operations;
create trigger hadas_daily_operations_updated_at before update on public.hadas_daily_operations
for each row execute function public.hadas_set_updated_at();

drop trigger if exists hadas_daily_operations_realtime on public.hadas_daily_operations;
create trigger hadas_daily_operations_realtime after insert or update or delete on public.hadas_daily_operations
for each row execute function public.hadas_emit_realtime_event();

insert into public.hadas_app_meta(id,schema_version,app_version)
values(1,'0.11.0','0.11.0')
on conflict(id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();

commit;
