-- Hadas Garden v0.31.0
-- PREPARED MIGRATION: apply only when v0.31 is approved for production.

begin;

alter table public.hadas_users
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.hadas_users.onboarding_completed_at is
  'When set, the short first-login guided tour has already been completed or skipped by this user.';

-- Existing users who have already used the system should not suddenly receive a first-login tour.
-- Users who have never logged in keep NULL and will receive the tour on their first real login.
update public.hadas_users
set onboarding_completed_at = last_login_at
where onboarding_completed_at is null
  and last_login_at is not null;

update public.hadas_app_meta
set schema_version = '0.31.0',
    app_version = '0.31.0',
    updated_at = now()
where id = 1;

commit;