-- v0.30.0 security follow-up: the approval table is server-only.
drop policy if exists hadas_schedule_issue_approvals_client_deny on public.hadas_schedule_issue_approvals;
create policy hadas_schedule_issue_approvals_client_deny
on public.hadas_schedule_issue_approvals
for all
to anon, authenticated
using (false)
with check (false);
