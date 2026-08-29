-- מערכת ניהול שיבוצים מעון הדס — עדכון 0.29.0
-- שינוי לא הרסני: הודעות Push בתוך המערכת בעת כניסה.

alter table public.hadas_announcements
  add column if not exists popup_on_login boolean not null default false;

create index if not exists hadas_announcements_popup_login_idx
  on public.hadas_announcements (popup_on_login, active, published_at)
  where popup_on_login = true and active = true;

update public.hadas_app_meta
set schema_version='0.29.0', app_version='0.29.0', updated_at=now()
where id=1;
