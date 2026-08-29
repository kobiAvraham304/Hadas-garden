-- מערכת ניהול שיבוצים מעון הדס — עדכון 0.28.0
-- שינוי לא הרסני: תקרת תקינה יומית אופציונלית לכל כיתה.

alter table public.hadas_app_settings
  add column if not exists max_daily_staff integer;

alter table public.hadas_app_settings
  drop constraint if exists hadas_app_settings_max_daily_staff_check;

alter table public.hadas_app_settings
  add constraint hadas_app_settings_max_daily_staff_check
  check (max_daily_staff is null or max_daily_staff between 1 and 20);

update public.hadas_app_meta
set schema_version='0.28.0', app_version='0.28.0', updated_at=now()
where id=1;
