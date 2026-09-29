-- 0.39.0 — Requests workflow, manual leave confirmation and data cleanup
alter table public.hadas_requests
  add column if not exists manual_leave_form_completed boolean not null default false,
  add column if not exists manual_leave_form_completed_at timestamptz,
  add column if not exists manual_leave_form_completed_by uuid references public.hadas_employees(id) on delete set null;

update public.hadas_requests
set requested_start=null
where request_type='early_finish' and requested_start is not null;

update public.hadas_requests
set requested_end=null
where request_type='late_start' and requested_end is not null;

update public.hadas_requests
set requested_start=null,requested_end=null
where request_type not in ('late_start','early_finish')
  and (requested_start is not null or requested_end is not null);

create index if not exists hadas_requests_cancellation_decided_by_idx
  on public.hadas_requests(cancellation_decided_by)
  where cancellation_decided_by is not null;

update public.hadas_app_meta
set schema_version='0.39.0',app_version='0.39.0',updated_at=now()
where id=1;
