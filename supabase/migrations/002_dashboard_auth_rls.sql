create table public.dashboard_users (
  email text primary key,
  created_at timestamptz not null default now(),
  note text
);

alter table public.dashboard_users enable row level security;
alter table public.projects enable row level security;
alter table public.providers enable row level security;
alter table public.resources enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.cost_snapshots enable row level security;
alter table public.health_checks enable row level security;
alter table public.collector_runs enable row level security;

create or replace function public.is_dashboard_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dashboard_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create policy "dashboard users can read allowlist"
on public.dashboard_users
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read projects"
on public.projects
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read providers"
on public.providers
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read resources"
on public.resources
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read metric snapshots"
on public.metric_snapshots
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read cost snapshots"
on public.cost_snapshots
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read health checks"
on public.health_checks
for select
to authenticated
using (public.is_dashboard_user());

create policy "dashboard users can read collector runs"
on public.collector_runs
for select
to authenticated
using (public.is_dashboard_user());
