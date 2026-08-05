-- מערכת ניהול שיבוצים מעון הדס — עדכון מגרסה 0.12.0 לגרסה 0.18.0
-- כולל שדרוג בקשות, נעיצת הודעות ומשימות ומעקב אישור קריאה.

begin;

alter table public.hadas_requests
  add column if not exists available_fixed_day_weekday smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hadas_requests_available_fixed_day_weekday_check'
  ) then
    alter table public.hadas_requests
      add constraint hadas_requests_available_fixed_day_weekday_check
      check (available_fixed_day_weekday is null or available_fixed_day_weekday between 0 and 5);
  end if;
end $$;

alter table public.hadas_announcements
  add column if not exists is_pinned boolean not null default false,
  add column if not exists requires_acknowledgement boolean not null default true;

alter table public.hadas_tasks
  add column if not exists is_pinned boolean not null default false;

create index if not exists hadas_announcements_pinned_idx
  on public.hadas_announcements(is_pinned desc, published_at desc)
  where active = true;

create index if not exists hadas_tasks_pinned_idx
  on public.hadas_tasks(is_pinned desc, created_at desc)
  where active = true;

insert into public.hadas_app_meta(id,schema_version,app_version)
values(1,'0.18.0','0.18.0')
on conflict(id) do update
set schema_version=excluded.schema_version,
    app_version=excluded.app_version,
    updated_at=now();

commit;
