-- מערכת ניהול שיבוצים מעון הדס — עדכון מגרסה 0.11.0 לגרסה 0.12.0
-- להריץ פעם אחת בלבד ב-Supabase SQL Editor.

begin;

-- מקור הדיווח מאפשר לחבר בין מסך הנוכחות לכלי התפעול היומי
-- בלי למחוק דיווח ידני שנוצר על ידי מנהלת המעון או אחראית השיבוץ.
alter table public.hadas_daily_operations
  add column if not exists source text not null default 'manual';

alter table public.hadas_daily_operations
  drop constraint if exists hadas_daily_operations_source_check;
alter table public.hadas_daily_operations
  add constraint hadas_daily_operations_source_check
  check (source in ('manual','attendance'));

create index if not exists hadas_attendance_date_status_idx
  on public.hadas_attendance(attendance_date,status,employee_id);
create index if not exists hadas_daily_operations_source_idx
  on public.hadas_daily_operations(operation_date,source,status);

insert into public.hadas_app_meta(id,schema_version,app_version)
values(1,'0.12.0','0.12.0')
on conflict(id) do update
set schema_version=excluded.schema_version,
    app_version=excluded.app_version,
    updated_at=now();

commit;
