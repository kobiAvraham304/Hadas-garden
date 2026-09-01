-- Hadas Garden v0.34.0
-- Attendance and daily operations reuse the existing indexed tables.
-- This release updates only the application/schema compatibility marker.

begin;

update public.hadas_app_meta
set schema_version = '0.34.0',
    app_version = '0.34.0',
    updated_at = now()
where id = 1;

commit;
