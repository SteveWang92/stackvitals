-- cost_snapshots.attribution was always written as a constant ('unallocated') and no
-- read path or allocation logic ever used it; project mapping is project_id. Apply this
-- only after deploying the collector version that stopped writing the column.
alter table public.cost_snapshots
  drop column if exists attribution;
