insert into public.providers (key, name)
values
  ('aws', 'AWS'),
  ('amplify', 'AWS Amplify'),
  ('supabase', 'Supabase'),
  ('resend', 'Resend'),
  ('cloudflare', 'Cloudflare'),
  ('openai', 'OpenAI'),
  ('github', 'GitHub Actions'),
  ('http', 'HTTP Health')
on conflict (key) do update set name = excluded.name;

-- Projects need no rows here: every collector run with hub write credentials syncs the
-- `projects` table from the collector config (projects.config.json). Keep any extra local
-- rows out of git in supabase/seed.local.sql (git-ignored, applied automatically by
-- `supabase db reset` after this file).
