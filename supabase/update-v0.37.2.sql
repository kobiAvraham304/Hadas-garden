-- 0.37.2 Web Push support
alter table public.hadas_announcements
  add column if not exists push_enabled boolean not null default false;

create table if not exists public.hadas_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  active boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hadas_push_subscriptions_employee_active_idx on public.hadas_push_subscriptions(employee_id,active);

create table if not exists public.hadas_push_config (
  id smallint primary key default 1 check (id=1),
  public_key text not null,
  private_key text not null,
  subject text not null default 'https://hadas-garden.vercel.app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hadas_push_subscriptions enable row level security;
alter table public.hadas_push_config enable row level security;
revoke all on public.hadas_push_subscriptions from anon,authenticated;
revoke all on public.hadas_push_config from anon,authenticated;
grant select,insert,update,delete on public.hadas_push_subscriptions to service_role;
grant select on public.hadas_push_config to service_role;
