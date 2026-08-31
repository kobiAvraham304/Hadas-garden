-- Hadas Garden v0.33.0
-- Add private calendar events without changing or deleting existing events.

begin;

alter table public.hadas_calendar_events
  drop constraint if exists hadas_calendar_events_visibility_check;

alter table public.hadas_calendar_events
  add constraint hadas_calendar_events_visibility_check
  check (visibility in ('all','managers','class','private'));

update public.hadas_app_meta
set schema_version = '0.33.0',
    app_version = '0.33.0',
    updated_at = now()
where id = 1;

commit;
