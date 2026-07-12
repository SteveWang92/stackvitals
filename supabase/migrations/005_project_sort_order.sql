-- Optional manual ordering for dashboard project cards. Null means "no explicit
-- position"; the read path orders by sort_order (nulls last), then by name.
alter table public.projects
  add column if not exists sort_order integer;
