-- The configured-inventory sync deletes resources of projects and providers the collector
-- config no longer lists, through the service role. Hosted Supabase grants this by default;
-- local from-scratch stacks need it explicitly.

grant delete on public.resources to service_role;
