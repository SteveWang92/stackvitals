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

-- Add one row per project you want the dashboard to track. Slugs must match the
-- `slug` values in your collector config (projects.config.json). Keep your real
-- rows out of git: put them in supabase/seed.local.sql (git-ignored, applied
-- automatically by `supabase db reset` after this file).
--
-- insert into public.projects (slug, name, public_url)
-- values
--   ('example_app', 'Example App', 'https://example.com')
-- on conflict (slug) do update
-- set name = excluded.name,
--     public_url = excluded.public_url,
--     updated_at = now();
