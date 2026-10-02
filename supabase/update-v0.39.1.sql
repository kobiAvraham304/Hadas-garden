-- 0.39.1 — lightweight performance maintenance
-- Cover the FK introduced for manual leave-form completion auditing.
create index if not exists hadas_requests_manual_leave_form_completed_by_idx
  on public.hadas_requests(manual_leave_form_completed_by)
  where manual_leave_form_completed_by is not null;

update public.hadas_app_meta
set schema_version='0.39.1', app_version='0.39.1', updated_at=now()
where id=1;
