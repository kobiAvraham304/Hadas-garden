-- מערכת ניהול שיבוצים מעון הדס — עדכון לגרסה 0.20.0
-- תחזוקה לא הרסנית: אינדקסים, session RPC, יישור אילוצים ומדיניות server-only מפורשת.

create index if not exists hadas_employees_primary_class_fk_idx on public.hadas_employees(primary_class_id);
create index if not exists hadas_shifts_created_by_fk_idx on public.hadas_shifts(created_by);
create index if not exists hadas_attendance_employee_fk_idx on public.hadas_attendance(employee_id);
create index if not exists hadas_attendance_updated_by_fk_idx on public.hadas_attendance(updated_by);
create index if not exists hadas_requests_requester_fk_idx on public.hadas_requests(requester_id);
create index if not exists hadas_requests_shift_fk_idx on public.hadas_requests(shift_id);
create index if not exists hadas_requests_target_employee_fk_idx on public.hadas_requests(target_employee_id);
create index if not exists hadas_requests_target_shift_fk_idx on public.hadas_requests(target_shift_id);
create index if not exists hadas_requests_decided_by_fk_idx on public.hadas_requests(decided_by);
create index if not exists hadas_announcements_class_fk_idx on public.hadas_announcements(class_id);
create index if not exists hadas_announcements_created_by_fk_idx on public.hadas_announcements(created_by);
create index if not exists hadas_announcement_reads_employee_fk_idx on public.hadas_announcement_reads(employee_id);
create index if not exists hadas_tasks_created_by_fk_idx on public.hadas_tasks(created_by);
create index if not exists hadas_task_assignees_employee_fk_idx on public.hadas_task_assignees(employee_id);
create index if not exists hadas_calendar_events_class_fk_idx on public.hadas_calendar_events(class_id);
create index if not exists hadas_calendar_events_created_by_fk_idx on public.hadas_calendar_events(created_by);
create index if not exists hadas_constraints_class_fk_idx on public.hadas_employee_class_constraints(class_id);
create index if not exists hadas_constraints_created_by_fk_idx on public.hadas_employee_class_constraints(created_by);
create index if not exists hadas_daily_operations_class_fk_idx on public.hadas_daily_operations(class_id);
create index if not exists hadas_daily_operations_replacement_employee_fk_idx on public.hadas_daily_operations(replacement_employee_id);
create index if not exists hadas_daily_operations_replacement_class_fk_idx on public.hadas_daily_operations(replacement_from_class_id);
create index if not exists hadas_daily_operations_created_by_fk_idx on public.hadas_daily_operations(created_by);
create index if not exists hadas_daily_operations_resolved_by_fk_idx on public.hadas_daily_operations(resolved_by);
create index if not exists hadas_schedule_changes_created_by_fk_idx on public.hadas_schedule_changes(created_by);
create index if not exists hadas_schedule_publications_published_by_fk_idx on public.hadas_schedule_publications(published_by);
create index if not exists hadas_audit_log_actor_fk_idx on public.hadas_audit_log(actor_employee_id);

alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_times_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_times_check check (
  (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
  or
  (day_type in ('work','avoid') and start_time is not null and end_time is not null and end_time > start_time)
);

alter table public.hadas_requests drop constraint if exists hadas_requests_request_type_check;
alter table public.hadas_requests add constraint hadas_requests_request_type_check
  check (request_type in ('leave','day_off','late_start','early_finish','sick','swap')) not valid;
DO $$ BEGIN
  IF NOT EXISTS (select 1 from public.hadas_requests where request_type='other') THEN
    ALTER TABLE public.hadas_requests VALIDATE CONSTRAINT hadas_requests_request_type_check;
  END IF;
END $$;

create or replace function public.hadas_get_session_context(p_token_hash text)
returns table(session_data jsonb, user_data jsonb, employee_data jsonb)
language sql
security definer
set search_path=pg_catalog,public
as $$
  select to_jsonb(s), to_jsonb(u), to_jsonb(e)
  from public.hadas_sessions s
  join public.hadas_users u on u.id=s.user_id and u.active
  join public.hadas_employees e on e.id=u.employee_id and e.active
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now()
  limit 1
$$;
revoke all on function public.hadas_get_session_context(text) from public, anon, authenticated;
grant execute on function public.hadas_get_session_context(text) to service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_app_meta','hadas_classes','hadas_employees','hadas_users','hadas_sessions','hadas_login_security',
    'hadas_employee_weekly_patterns','hadas_employee_class_constraints','hadas_employee_private','hadas_shifts',
    'hadas_schedule_publications','hadas_schedule_changes','hadas_attendance','hadas_daily_operations','hadas_requests',
    'hadas_notifications','hadas_announcements','hadas_announcement_reads','hadas_announcement_recipients','hadas_tasks',
    'hadas_task_assignees','hadas_calendar_events','hadas_documents','hadas_audit_log','hadas_app_settings','hadas_feedback'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS hadas_server_only_deny ON public.%I',t);
    EXECUTE format('CREATE POLICY hadas_server_only_deny ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',t);
  END LOOP;
END $$;

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values (1,'0.20.0','0.20.0',now())
on conflict (id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
