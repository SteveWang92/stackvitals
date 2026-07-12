# Self-Hosting

Everything here applies to any fork or clone of this template. Nothing in this doc assumes
a particular hosting provider — the frontend is a static Vite build that deploys the same way
to Amplify, Vercel, Netlify, or Cloudflare Pages, and the collector is a Node script that runs
the same way from the committed GitHub Actions cron or any other scheduler.

## 0. Local development uses a separate database

Never point local `.env` at your production Supabase project. Local dev and any local
`npm run collect:status` runs use a local Supabase stack instead, so testing never writes into
prod or shows prod data mixed with test runs.

1. Install Docker Desktop and make sure it's running.
2. `npx supabase start` — boots a local Postgres/Auth/REST stack, applying every file in
   `supabase/migrations/`, then `supabase/seed.sql` (providers registry + commented project
   template), then the git-ignored `supabase/seed.local.sql` (your real project rows) when it
   exists. Re-run `npx supabase db reset` any time you want a clean slate after adding a
   migration.
3. Point local `.env` at the printed `API_URL` (`http://127.0.0.1:54321`), `ANON_KEY`, and
   `SERVICE_ROLE_KEY` instead of the prod values. Leave `VITE_DASHBOARD_ALLOWED_EMAIL` as your
   own email.
4. Create a local login user and allow-list row (the local stack starts with no users):

   ```bash
   curl -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
     -H "apikey: <local service_role key>" -H "Authorization: Bearer <local service_role key>" \
     -H "Content-Type: application/json" \
     -d '{"email":"you@example.com","password":"<a local-only password>","email_confirm":true}'
   ```

   ```sql
   insert into public.dashboard_users (email, note) values ('you@example.com', 'local dev') on conflict (email) do nothing;
   ```

Prod credentials only belong in your scheduler's secrets and your host's build-time env vars —
never in a local file.

## 1. Create your Supabase project

1. Create a Supabase project for your dashboard instance.
2. Apply migrations in `supabase/migrations/`.
3. Run `supabase/seed.sql` (providers registry), then insert your own project rows — copy the
   commented template in that file into a git-ignored `supabase/seed.local.sql` and run it, so
   your real slugs, names, and URLs never land in git.
4. In Supabase Auth, disable public signup if you want this to stay single-owner.
5. Create your own Auth user manually in Supabase.
6. Add the same email to the allowlist:

   ```sql
   insert into public.dashboard_users (email, note)
   values ('you@example.com', 'owner')
   on conflict (email) do nothing;
   ```

You manually create or invite the login user in Supabase. The app then checks that signed-in
user's email against `VITE_DASHBOARD_ALLOWED_EMAIL`, and the database checks the same email
against `public.dashboard_users` through RLS. To allow more than one person in, set
`VITE_DASHBOARD_ALLOWED_EMAIL` to a comma-separated list and add each email to
`public.dashboard_users` — both gates must pass.

## 2. Configure the collector

Real IDs and secrets never belong in git — put them in local `.env` files or your host/scheduler's
secret store.

Quick order:

1. Copy `projects.example.json` to `projects.config.json` (git-ignored) or another private
   config location.
2. Replace placeholder URLs and resource IDs with your own. Any project resource field can be a
   `${ENV_VAR}` placeholder instead of a literal value — the collector resolves it from the
   environment at run time and fails fast naming any variable that's missing (empty just
   disables that adapter). Use `$$` to escape a literal `$`.
3. Add secrets to your local env or your scheduler's secrets.
4. Run `npm test`, then `npm run collect:status`. The local collector uses
   `projects.config.json` automatically when present; pass `-- --config path/to/file.json` to
   use a different file.
5. After it works locally, add the same config/secrets to your scheduled workflow.

### Config values

| Area                 | Needed                                                                 | Who Can Get It                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| HTTP health          | Public URL for each app, optional `resources.healthCheckUrl` override | User provides; the override is only needed when the public URL is blocked by Cloudflare Bot Fight Mode                       |
| Amplify              | App ID, branch name, region                                           | User can copy from AWS console                                                                                                |
| AWS Cost Explorer    | AWS account/payer, region                                             | User can copy from AWS console; costs are collected account-level per AWS service                                             |
| Hub Supabase         | Project URL, anon key, JWT service-role key                           | User copies from the dashboard's own Supabase project; JWT service-role key is secret and used only by collectors            |
| Watched app Supabase | Project URL, anon key, service-role key, aggregate RPC name           | User copies from the watched app's Supabase project; collector calls count-only aggregate RPCs only                          |
| Resend               | API key, sending domain, optional email category/tag                  | User creates/copies API key                                                                                                   |
| OpenAI               | Admin API key, optional API key ID labels                             | User creates/copies admin key; labels are fake-safe display names for API key IDs, not secret key values                     |
| GitHub Actions       | Repository `owner/repo` mappings, read token                          | GitHub Actions can use the built-in token for the collector's own repo; private cross-repo collection needs a PAT            |
| Cloudflare           | API token, optional account ID, configured domain names               | User creates/copies a read-only token; account ID enables registrar expiration lookup when available                         |

### Required secrets

- `PROJECTS_CONFIG_JSON`: private collector config JSON for your scheduler.
- `VITE_SUPABASE_URL`: your dashboard's Supabase URL.
- `VITE_SUPABASE_ANON_KEY`: your dashboard's anon key.
- `HUB_SUPABASE_JWT_SERVICE_ROLE_KEY`: your dashboard's JWT service-role key for collector
  writes.
- Per-app credentials referenced by `${...}` placeholders in the collector config. A project
  with `resources.supabaseAggregateRpcName` also declares `supabaseUrl` /
  `supabaseServiceRoleKey` / `supabaseAnonKey` whose values are placeholders (e.g.
  `"supabaseUrl": "${MY_APP_SUPABASE_URL}"`); create a secret per referenced variable and pass
  it through in the workflow env block in `.github/workflows/collect.yml` (or your scheduler's
  equivalent).
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `RESEND_API_KEY` (the sending domain comes from `resources.resendDomain` in the collector
  config, not an env var)
- `OPENAI_ADMIN_API_KEY`
- `GH_ACTIONS_TOKEN` or GitHub Actions' built-in `GITHUB_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- Optional `CLOUDFLARE_ACCOUNT_ID` for registrar domain details and expiration dates
- Optional `HTTP_HEALTH_CHECK_HEADER_NAME` / `HTTP_HEALTH_CHECK_HEADER_VALUE`: sent as a
  request header on the public-URL health check so a Cloudflare WAF rule can skip **Super Bot
  Fight Mode** for this collector only; does not work for free-plan Bot Fight Mode (see below)

Every adapter is opt-in: it's only added to the run when its credentials are present, so a
fresh clone with nothing but `PROJECTS_CONFIG_JSON` still runs the HTTP-health adapter alone.

### Local commands

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run collect:http` — quick public-URL probe only, prints JSON, writes nothing
- `npm run collect:status` — runs every configured adapter and writes results to Supabase when
  hub write credentials are present

For local GitHub Actions collection:

1. Add `GH_ACTIONS_TOKEN` to your local `.env`.
2. Add `resources.githubRepository` as `owner/repo` for each project in `projects.config.json`.
3. Run `npm run collect:status`.

Use a fine-grained PAT with read-only repository access and Actions read permission. If you
only collect a public repo, a token may still be useful to avoid low unauthenticated rate
limits; private repos require a token with access to those repos. The dashboard derives recent
runtime minutes from workflow run durations — it does not read GitHub billing endpoints.

For local Cloudflare collection:

1. Add `CLOUDFLARE_API_TOKEN` to your local `.env`.
2. Add `CLOUDFLARE_ACCOUNT_ID` when registrar domain details should be collected.
3. Add a top-level `domains` group to `projects.config.json` — `provider: "cloudflare"`, the
   owning `projectSlug`, and the `domains` list (see `projects.example.json`). Omit `projectSlug`
   for domains shared across several projects: the group stays unallocated (`project_id` null),
   so the domains still show on the Domains tab but aren't attributed to any one project.
4. Run `npm run collect:status`.

Use a read-only Cloudflare API token that can read zones and DNS records. Registrar expiration
is best-effort because it depends on account-level registrar access and whether the domain is
registered at Cloudflare.

If the public-URL health check returns 403 from a hosted scheduler but works fine from
elsewhere, Cloudflare Bot Fight Mode is most likely flagging the runner's datacenter IP range.
The collector already sends a browser-like `User-Agent`, but that alone won't bypass it.
`HTTP_HEALTH_CHECK_HEADER_NAME` / `HTTP_HEALTH_CHECK_HEADER_VALUE` plus a WAF custom rule with
a Skip action only work around **Super Bot Fight Mode** (Pro plan and above) — free-plan **Bot
Fight Mode** doesn't run on the Ruleset Engine at all, so no custom rule can exempt it. For a
free-plan zone, set `resources.healthCheckUrl` on the affected project to a target that
bypasses Cloudflare entirely instead (an Amplify app's free default domain, for example). The
dashboard's clickable link keeps using `publicUrl`; only the health-check probe uses the
override.

Optional OpenAI display labels and GitHub repository mappings live in private collector config,
not env vars:

```json
{
  "projects": [
    {
      "slug": "my_app",
      "name": "My App",
      "resources": {
        "githubRepository": "owner/repo"
      }
    }
  ],
  "githubActions": {
    "usageLookbackDays": 30,
    "runLimit": 50
  },
  "openAi": {
    "usageLookbackDays": 30,
    "apiKeyLabels": {
      "key_example": "Dashboard collector"
    }
  }
}
```

### Data boundaries

Collect aggregate operational signals only:

- HTTP status, response time, deploy state, resource status, monthly costs, domain status, and
  count-only app health.
- OpenAI token totals, request counts, cached-token counts, and cost totals by API key/model
  where available.
- GitHub Actions workflow run counts, latest status/conclusion, trigger type, branch, duration
  totals, and scheduled-run counts.
- Cloudflare zone status, paused state, DNS record counts, apex/www/MX presence, proxied record
  counts, registrar name, and expiration days when available.
- Do not collect user records, email addresses, email bodies, verification links, prompts,
  responses, files, user identifiers, request payloads, expenses, bills, raw workflow logs,
  commit contents, patches, or raw app table dumps.
- Keep your dashboard's Supabase credentials separate from tracked apps' Supabase credentials.
  The hub JWT service-role key writes collector results into the dashboard; a watched app's key
  should only call count-only RPCs or aggregate views in that app's own project.

## 3. Set frontend secrets

Set these in your hosting provider:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DASHBOARD_ALLOWED_EMAIL`

Do not put `HUB_SUPABASE_JWT_SERVICE_ROLE_KEY`, any watched app's Supabase service-role key,
AWS keys, or Resend keys in frontend hosting env vars.

## 4. Deploy the static site

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Any static host works identically — Amplify, Vercel, Netlify, Cloudflare Pages. Optional first
layer: most hosts offer branch-level access control/password protection; keep Supabase Auth and
RLS regardless.

## 5. Add this site to the hub

The dashboard can track itself like any other project: add a row for it in your
`seed.local.sql` / projects table, and give it `"hubSupabase": true` in the collector config
(see `projects.example.json`) so the self-health collector targets it. After deployment,
replace the placeholder URL and resource IDs in your private collector config.

## 6. Run the scheduled collector

The committed `.github/workflows/collect.yml` runs `npm run collect:status` on a daily cron and
works as-is on any fork — just add the secrets listed above and point its env block at whatever
`${...}` variable names your config references. Any other scheduler that can run
`npm run collect:status` (a cron job, a serverless scheduled function, etc.) works the same way.

If you keep the collector on GitHub Actions and your repo is public, be aware that workflow run
logs are publicly visible and the collector prints project slugs, URLs, health status, and
error messages — running it from a public repo publishes a daily operational status feed of
your apps. Keep the collector workflow in a private repo, or in a separate private repo from
your public code, if that matters to you.

## 7. Verify

Run:

```bash
npm test
npm run lint
npm run build
```

Then open the deployed site:

- Signed out: login form appears before dashboard data renders.
- Wrong email: sign-in is rejected.
- Allowed email: dashboard renders.
- Browser anon queries: RLS only returns rows for allowlisted authenticated users.
