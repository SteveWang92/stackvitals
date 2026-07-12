create extension if not exists "pgcrypto";

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  public_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  resource_type text not null,
  external_id text,
  display_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, resource_type, external_id)
);

create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete restrict,
  provider_id uuid references public.providers(id) on delete restrict,
  resource_id uuid references public.resources(id) on delete set null,
  metric_key text not null,
  metric_value numeric,
  status text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

create table public.cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  service_name text not null,
  period_start date not null,
  period_end date not null,
  amount_usd numeric(12, 4),
  attribution text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

create table public.health_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete restrict,
  url text not null,
  status text not null,
  http_status integer,
  response_time_ms integer,
  error_message text,
  checked_at timestamptz not null default now()
);

create table public.collector_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  summary text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index projects_slug_idx on public.projects (slug);
create index resources_project_id_idx on public.resources (project_id);
create index metric_snapshots_project_collected_idx on public.metric_snapshots (project_id, collected_at desc);
create index cost_snapshots_project_period_idx on public.cost_snapshots (project_id, period_start desc);
create index health_checks_project_checked_idx on public.health_checks (project_id, checked_at desc);
create index collector_runs_started_idx on public.collector_runs (started_at desc);

