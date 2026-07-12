-- Example count-only aggregate RPC for a watched app's Supabase project.
-- Create a function like this in the WATCHED APP's database (not the hub's), then set
-- `resources.supabaseAggregateRpcName` for that project in the collector config.
-- The hub only ever calls this RPC — it never reads the app's tables directly — so the
-- dashboard sees operational counts without any raw app data leaving the app's project.
-- Extend the second branch with count(*) selects over your own tables as needed.

create or replace function public.collect_app_status(project_ref text)
returns table (
  metric_key text,
  metric_value numeric,
  status text,
  resource_type text,
  resource_name text,
  metadata jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    'app_database_available'::text as metric_key,
    1::numeric as metric_value,
    'healthy'::text as status,
    'database'::text as resource_type,
    project_ref::text as resource_name,
    jsonb_build_object('aggregateOnly', true) as metadata
  union all
  select
    'app_public_table_count'::text,
    count(*)::numeric,
    'healthy'::text,
    'schema'::text,
    'public'::text,
    jsonb_build_object('aggregateOnly', true)
  from pg_catalog.pg_tables
  where schemaname = 'public';
$$;
