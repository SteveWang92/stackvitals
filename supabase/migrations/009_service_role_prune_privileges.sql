-- Snapshot retention deletes expired collector data through the service role.
-- Hosted Supabase grants this by default; local from-scratch stacks need it explicitly.

grant delete on
  public.metric_snapshots,
  public.cost_snapshots,
  public.health_checks,
  public.collector_runs
to service_role;
