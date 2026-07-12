-- The hosted Supabase platform grants anon/authenticated/service_role
-- default privileges on public schema tables automatically. A from-scratch
-- self-hosted stack (e.g. local dev via `supabase start`) does not, so
-- reads and collector writes fail there without this. No-op on hosted
-- projects that already have these grants.

grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.dashboard_users,
  public.projects,
  public.providers,
  public.resources,
  public.metric_snapshots,
  public.cost_snapshots,
  public.health_checks,
  public.collector_runs
to authenticated;

grant select, insert, update on
  public.dashboard_users,
  public.projects,
  public.providers,
  public.resources,
  public.metric_snapshots,
  public.cost_snapshots,
  public.health_checks,
  public.collector_runs
to service_role;
