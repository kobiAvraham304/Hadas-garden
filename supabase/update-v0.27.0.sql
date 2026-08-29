-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.27.0
-- יום חופשי כללי בלוח השנה שמשפיע על השיבוץ.

alter table public.hadas_calendar_events
  add column if not exists is_general_day_off boolean not null default false;

create index if not exists hadas_calendar_general_day_off_date_idx
  on public.hadas_calendar_events(event_date)
  where is_general_day_off = true;

comment on column public.hadas_calendar_events.is_general_day_off is
  'כאשר true המעון סגור לכלל העובדים בתאריך האירוע ואין ליצור שיבוצים לאותו יום';

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.27.0','0.27.0',now())
on conflict(id) do update
set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
