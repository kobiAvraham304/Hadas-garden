-- מערכת ניהול שיבוצים מעון הדס — עדכון לגרסה 0.19.0
-- מוסיף תקינת בוקר, ימי "עדיף להימנע" למשלימי מקום ומערכת משוב פנימית.
begin;

alter table public.hadas_app_settings
  add column if not exists morning_end_time time not null default '08:15',
  add column if not exists morning_required_staff integer not null default 4;

alter table public.hadas_app_settings
  drop constraint if exists hadas_app_settings_morning_required_staff_check;
alter table public.hadas_app_settings
  add constraint hadas_app_settings_morning_required_staff_check
  check (morning_required_staff between 1 and 10);

alter table public.hadas_employee_weekly_patterns
  drop constraint if exists hadas_employee_weekly_patterns_day_type_check;
alter table public.hadas_employee_weekly_patterns
  add constraint hadas_employee_weekly_patterns_day_type_check
  check (day_type in ('work','day_off','as_needed','avoid'));

alter table public.hadas_employee_weekly_patterns
  drop constraint if exists hadas_employee_weekly_patterns_times_check;
alter table public.hadas_employee_weekly_patterns
  add constraint hadas_employee_weekly_patterns_times_check
  check (
    (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
    or
    (day_type in ('work','avoid') and start_time is not null and end_time is not null and end_time > start_time)
  );

create table if not exists public.hadas_feedback (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  topic text not null check (topic in ('שיבוצים','בקשות','תפעול יומי','עובדים','הודעות ומשימות','לוח שנה','תקלה/באג','שיפור/רעיון','אחר')),
  content text not null check (char_length(content) between 3 and 4000),
  status text not null default 'open' check (status in ('open','replied','closed')),
  response_text text,
  responded_by uuid references public.hadas_employees(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hadas_feedback_employee_idx on public.hadas_feedback(employee_id, created_at desc);
create index if not exists hadas_feedback_status_idx on public.hadas_feedback(status, created_at desc);
create index if not exists hadas_feedback_responded_by_idx on public.hadas_feedback(responded_by) where responded_by is not null;
alter table public.hadas_feedback enable row level security;
revoke all on table public.hadas_feedback from anon, authenticated;

do $$ begin
  if to_regprocedure('public.hadas_set_updated_at()') is not null then
    drop trigger if exists hadas_feedback_updated_at on public.hadas_feedback;
    create trigger hadas_feedback_updated_at before update on public.hadas_feedback
    for each row execute function public.hadas_set_updated_at();
  end if;
end $$;

-- הקשחת פונקציות trigger: אינן חשופות כ-RPC ללקוחות וה-search_path קבוע.
alter function public.hadas_set_updated_at() set search_path = pg_catalog, public;
alter function public.hadas_prevent_shift_overlap() set search_path = pg_catalog, public;
alter function public.hadas_emit_realtime_event() set search_path = pg_catalog, public;
revoke all on function public.hadas_set_updated_at() from public, anon, authenticated;
revoke all on function public.hadas_prevent_shift_overlap() from public, anon, authenticated;
revoke all on function public.hadas_emit_realtime_event() from public, anon, authenticated;
grant execute on function public.hadas_set_updated_at() to service_role;
grant execute on function public.hadas_prevent_shift_overlap() to service_role;
grant execute on function public.hadas_emit_realtime_event() to service_role;

insert into public.hadas_app_meta(id, schema_version, app_version, updated_at)
values (1,'0.19.0','0.19.0',now())
on conflict (id) do update
set schema_version=excluded.schema_version,
    app_version=excluded.app_version,
    updated_at=now();

commit;
