-- The dashboard read path orders every snapshot table by its timestamp with no project_id
-- predicate, and the 30-day history window added for latency/uptime trends filters on
-- checked_at alone. The existing indexes from 001 all lead with project_id, so none of them
-- can serve those reads -- Postgres falls back to a sequential scan plus a top-N sort, and
-- account-level rows (project_id is null) are hit hardest. These add the missing
-- leading-timestamp indexes. Safe to apply at any time; the app works without them, just slower.
create index if not exists health_checks_checked_at_idx
  on public.health_checks (checked_at desc);

create index if not exists metric_snapshots_collected_at_idx
  on public.metric_snapshots (collected_at desc);

create index if not exists cost_snapshots_collected_at_idx
  on public.cost_snapshots (collected_at desc);
