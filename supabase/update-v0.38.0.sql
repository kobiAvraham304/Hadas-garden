-- 0.38.0 Smart shift Push preferences and idempotent reminder delivery

create table if not exists public.hadas_push_preferences (
  employee_id uuid primary key references public.hadas_employees(id) on delete cascade,
  smart_shift_reminders boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_shift_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  shift_date date not null,
  reminder_type text not null check (reminder_type in ('one_hour','shift_start')),
  schedule_fingerprint text not null,
  status text not null default 'reserved' check (status in ('reserved','sent','failed')),
  attempts integer not null default 1 check (attempts between 1 and 3),
  push_sent_count integer not null default 0 check (push_sent_count >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id,shift_date,reminder_type)
);
create index if not exists hadas_shift_reminder_deliveries_date_status_idx
  on public.hadas_shift_reminder_deliveries(shift_date,status);

alter table public.hadas_push_preferences enable row level security;
alter table public.hadas_shift_reminder_deliveries enable row level security;
revoke all on public.hadas_push_preferences from anon,authenticated;
revoke all on public.hadas_shift_reminder_deliveries from anon,authenticated;
grant select,insert,update,delete on public.hadas_push_preferences to service_role;
grant select,insert,update,delete on public.hadas_shift_reminder_deliveries to service_role;

insert into public.hadas_push_preferences(employee_id,smart_shift_reminders)
select distinct employee_id,true
from public.hadas_push_subscriptions
where active=true
on conflict(employee_id) do nothing;

do $$
begin
  if not exists(
    select 1 from vault.decrypted_secrets
    where name='hadas_shift_reminder_worker_token'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'hadas_shift_reminder_worker_token',
      'Server-only token for Hadas smart shift reminder worker'
    );
  end if;
end
$$;

create or replace function public.hadas_get_shift_reminder_worker_token_v038()
returns text
language sql
security definer
set search_path = public,vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='hadas_shift_reminder_worker_token'
  limit 1
$$;
revoke all on function public.hadas_get_shift_reminder_worker_token_v038() from public,anon,authenticated;
grant execute on function public.hadas_get_shift_reminder_worker_token_v038() to service_role;

create or replace function public.hadas_claim_shift_reminder_v038(
  p_employee_id uuid,
  p_shift_date date,
  p_reminder_type text,
  p_schedule_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  if p_reminder_type not in ('one_hour','shift_start') then
    raise exception 'HADAS_INVALID_REMINDER_TYPE';
  end if;

  insert into public.hadas_shift_reminder_deliveries(
    employee_id,shift_date,reminder_type,schedule_fingerprint,status,attempts,updated_at
  ) values (
    p_employee_id,p_shift_date,p_reminder_type,p_schedule_fingerprint,'reserved',1,now()
  )
  on conflict(employee_id,shift_date,reminder_type) do nothing
  returning true into v_claimed;

  if coalesce(v_claimed,false) then
    return true;
  end if;

  update public.hadas_shift_reminder_deliveries
  set status='reserved',
      attempts=attempts+1,
      schedule_fingerprint=p_schedule_fingerprint,
      last_error=null,
      updated_at=now()
  where employee_id=p_employee_id
    and shift_date=p_shift_date
    and reminder_type=p_reminder_type
    and attempts<3
    and (
      status='failed'
      or (status='reserved' and updated_at < now()-interval '5 minutes')
    )
  returning true into v_claimed;

  return coalesce(v_claimed,false);
end;
$$;
revoke all on function public.hadas_claim_shift_reminder_v038(uuid,date,text,text) from public,anon,authenticated;
grant execute on function public.hadas_claim_shift_reminder_v038(uuid,date,text,text) to service_role;
