-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.23.0
-- בקשות בשם עובד, שיח דו-צדדי ותיעוד מנהלי. מיגרציה לא הרסנית.

alter table public.hadas_requests add column if not exists created_by uuid;
alter table public.hadas_requests add column if not exists submitted_by_manager boolean not null default false;
update public.hadas_requests set created_by=requester_id where created_by is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='hadas_requests_created_by_fkey' and conrelid='public.hadas_requests'::regclass) then
    alter table public.hadas_requests add constraint hadas_requests_created_by_fkey foreign key(created_by) references public.hadas_employees(id) on delete set null;
  end if;
end $$;
create index if not exists hadas_requests_created_by_idx on public.hadas_requests(created_by);

create table if not exists public.hadas_request_messages (
  id bigserial primary key,
  request_id uuid not null references public.hadas_requests(id) on delete cascade,
  author_id uuid not null references public.hadas_employees(id) on delete restrict,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists hadas_request_messages_request_idx on public.hadas_request_messages(request_id,created_at);
create index if not exists hadas_request_messages_author_idx on public.hadas_request_messages(author_id);
alter table public.hadas_request_messages enable row level security;
revoke all on table public.hadas_request_messages from anon,authenticated;
grant all on table public.hadas_request_messages to service_role;
grant usage,select on sequence public.hadas_request_messages_id_seq to service_role;
drop policy if exists hadas_server_only_deny on public.hadas_request_messages;
create policy hadas_server_only_deny on public.hadas_request_messages for all to anon,authenticated using(false) with check(false);

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.23.0','0.23.0',now())
on conflict(id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
