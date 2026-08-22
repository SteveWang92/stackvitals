# StackVitals

This document records what StackVitals is, how it is built, and the decisions and data-safety
rules that govern it. It is a reference for the current system, not a roadmap.

## Summary

StackVitals is a lightweight, self-hosted operations dashboard for a solo developer's web
projects. It collects running status, deployment state, usage signals, and cost data for the
apps you configure — in one place, on one database, without copying raw application data.

The tool is a **config-driven template**: which apps it tracks is data, not code. Project rows
live in the `projects` table (seeded per deployment), and per-project provider resources live
in a git-ignored collector config (`projects.config.json`; `projects.example.json` is the
committed shape). The original author's own deployment is just one instance of the template.

Typical tracked apps look like:

- A static site deployed on AWS Amplify with DNS on Cloudflare.
- A full app on Amplify with auth/data on Supabase and transactional email via Resend.
- A full app on Amplify with auth/data on AWS primitives (Cognito + DynamoDB).
- Another app using an Amplify backend environment.
- The dashboard itself (it can track its own Supabase project and deployment).

Scope is status, cost, and basic aggregate usage for a single owner's projects. Tracked apps
stay on their existing hosting; low cost is preferred over high-frequency monitoring. Version
`1.0.0` was the first baseline release.

## Naming

The name is always presented with the subtitle **Stack Status Hub** (中文：独立开发者的状态中心) —
in the app header and sign-in screen, the `index.html` title, the README, the `package.json`
description, and both landing pages. The subtitle explains the product at a glance and
distinguishes it from `stackvital.com`, an unrelated nutrition site that uses the singular form
of the name.

Renaming was considered and rejected: the two occupy entirely different sectors, this is a
single-owner tool rather than a product competing for the same audience, and a rename would
mean buying new domains and reworking the Amplify app plus the GitHub Pages site. The subtitle
is deliberately **not** "Project Status Hub", which would collide with the separate
`project-status-hub` repository.

## Current State

- Static React/Vite dashboard with Supabase Auth and RLS-protected reads.
- Supabase schema for projects, providers, resources, metric snapshots, cost snapshots, health checks, and collector runs.
- GitHub Actions/manual collector path for low-cost scheduled collection.
- Provider adapters for HTTP health, Amplify status, AWS Cost Explorer, watched-app Supabase aggregate status, hub Supabase self-health, Resend verification-email health, OpenAI aggregate usage/cost, GitHub Actions usage/CI status, and Cloudflare domain inventory.
- Dashboard views for overview cards, tabbed app detail, tabbed collector diagnostics/settings, cost snapshots, OpenAI usage, GitHub Actions usage, loading, empty, stale, and failure states.
- Mocked provider tests and focused status/data tests.
- `${ENV_VAR}` placeholder interpolation in the collector config, so adapter credentials are declared in config and supplied by the environment — nothing app-specific lives in code.
- Astro Starlight documentation site in `site/`, deployed to GitHub Pages at stackvitals.dev via `.github/workflows/deploy-site.yml`. Landing page, self-hosting guide, architecture overview, adapter reference, and contributing/security/changelog docs.

Operational setup (live secrets, owner allowlist, deployed verification) is documented in
`docs/SELF_HOSTING.md`.

## Non-Goals

These boundaries are deliberate and hold across the project:

- Do not copy raw app user data or private application records of any kind.
- Do not add always-on servers or paid monitoring services.
- Do not require tracked apps to migrate hosting or database providers.
- Do not require write access to tracked apps.
- Do not build broad multi-user administration beyond the private single-owner dashboard needs.
- Do not add provider adapters before there is a clear dashboard need for their data.
- Do not store email recipient addresses, message bodies, verification tokens, or raw Resend event payloads.

## Architecture

Supabase is the backend database and auth layer for this tool. The frontend is a static
React/Vite app that can be deployed cheaply on any static host. There are no always-on servers:
collection runs on a schedule plus manual refresh.

High-level structure:

```text
stackvitals/
  src/
    collectors/
      providers/
      liveClients/
      stores/
    services/
    lib/
    tests/
  site/             # Astro Starlight docs site, deployed to GitHub Pages
  supabase/
    migrations/
  docs/
  scripts/
```

## Data Model

The normalized tables support more providers later:

- `projects`: one row per tracked app, keyed by a free-form `slug` that matches the collector config.
- `providers`: provider registry, such as `aws`, `amplify`, `supabase`, `resend`, `openai`, `github`, `cloudflare`. New keys are added together with their collector, never ahead of it.
- `resources`: deployments, domains, databases, auth stores, storage buckets, API accounts, and other provider resources.
- `metric_snapshots`: status, counts, usage, latency, deploy state, and collection results over time.
- `cost_snapshots`: daily or monthly cost by provider and service. Rows are always account-level: `project_id` exists for a future allocation scheme, but no adapter writes it, and the dashboard reads every row regardless of it.
- `health_checks`: uptime, HTTP status, response time, and last successful collection.
- `collector_runs`: audit trail for each scheduled or manual collection run, including errors.

Snapshots are append-only — the read layer picks the latest per logical key rather than updating
in place. Only aggregate operational data is stored; user records, transactions, and other raw
app data never enter this tool.

The one exception to "latest per key" is the trend history. `fetchDashboardData` issues a
separate, narrowly-projected `health_checks` query bounded to the last 30 days
(`HISTORY_WINDOW_DAYS`), which feeds per-project latency and uptime charts. It is deliberately
kept in its own array and never merged into the latest-per-key rows, so the status read path is
unaffected by it. Day bucketing is UTC, and a day the collector never wrote becomes an explicit
`no-data` state rather than an outage — a missed run is silence, not downtime. Month-to-date
cost history is scoped to the current billing period, because `cost_snapshots.amount_usd` is
cumulative for its period and resets on the 1st; the Costs tab charts the rise between
collections as spend per day, spreading a skipped day's rise across the days it covers rather
than spiking on the day collection resumed.

The OpenAI and GitHub Actions usage charts are not the same kind of series. Those metrics are
rolling-window totals, not period totals, so each point is the figure the collector reported
that day rather than that day's own consumption — the charts show whether usage is climbing,
and their headings say "by collection day" to keep that distinction visible.

## Provider Adapters

Each adapter exposes a common interface for collecting resources, metrics, costs, and health.
Adapter logic lives in `providers/`; real API calls are isolated in `liveClients/`.

Implemented adapters:

- HTTP health: perform direct uptime checks for public app URLs.
- Amplify: collect app, branch, deployment, domain, and backend environment status.
- AWS core: collect account/service cost through Cost Explorer and resource metadata where needed.
- AWS app backend (watched app): collect Cognito user-pool availability and estimated user count plus each DynamoDB table's status, item count, and size, for apps whose auth/data layer is AWS primitives rather than a managed platform. `Describe*` calls only — the same count-only boundary the Supabase aggregate adapter keeps. A project opts in with `cognitoUserPoolId` / `dynamoDbTables`, and `awsBackendRegion` covers a backend in a different region from the Amplify app fronting it.
- Supabase (watched app): call a count-only aggregate RPC in the app's own project (see `docs/examples/app-aggregate-rpc.sql`) so operational counts arrive without raw data.
- Supabase (hub self-health): collect project status for the dashboard's own Supabase project, selected by the `hubSupabase` config flag.
- Resend: collect sending-domain verification status and API health. Aggregate delivery counts are **not collectable** within this project's boundaries and have been removed: Resend exposes no analytics/statistics endpoint, `GET /emails` returns raw per-message rows (recipient addresses, subjects) with no date or tag filter, and the only documented aggregate path is streaming webhook events into a self-run database, which needs an always-on receiver. Both conflict with the non-goals above.
- OpenAI: collect aggregate organization API usage by API key/model plus cost totals without prompts, responses, files, user identifiers, or request payloads.
- GitHub Actions: collect workflow status, CI failures, scheduled-run health, and runtime minutes from workflow run duration. Projects deployed by a GitHub Actions workflow (e.g. GitHub Pages) can name that workflow via `githubDeployWorkflow`; its latest run is reported as the project's deploy status, the same role Amplify metrics play for Amplify-hosted projects.
- Cloudflare: collect zone status, paused state, relevant DNS record presence/counts, registrar name, and expiration days when the account exposes registrar data. For projects deployed on Cloudflare Pages, set `cloudflarePagesProject` in the collector config to report the latest production deployment status — a third deploy-status source alongside Amplify and GitHub Actions.

## Project Mapping

The project uses a checked-in config template plus local secret environment variables.

`projects.example.json` and `.env.example` use fake or placeholder identifiers only. Real API
keys, private account IDs, access tokens, Supabase service-role keys, and AWS credentials stay in
local environment variables or deployment secrets. Adapter credentials are declared in config as
`${ENV_VAR}` placeholders and resolved at collector startup — a missing variable fails the run
with a clear error; an empty value disables that adapter.

Example tracked resources per project: Amplify app id, public URL/domain, Cloudflare domain list,
Supabase project ref + aggregate RPC name, Cognito user pool id + DynamoDB table names, Resend
domain, GitHub repository, Amplify backend environment.

## Collection

Collection runs at low frequency to control cost and complexity: daily cost snapshots, daily
provider inventory snapshots, and a manual `refresh now` path for ad hoc checks. Scheduling uses
a GitHub Actions cron plus a manual workflow trigger, and scheduled production collectors run only
from `main`. The frontend stays static with no always-on server.

Retention reuses the same run: after recording results, the collector deletes snapshot rows older
than `SNAPSHOT_RETENTION_DAYS` (default 90, floor 31) from `metric_snapshots`, `cost_snapshots`,
`health_checks`, and `collector_runs`. The append-only tables would otherwise grow without bound
even though nothing reads past the 30-day history window, and this keeps the cleanup on the
existing schedule instead of adding pg_cron or a second service. A prune failure is logged, not
thrown — the run's data is already stored, and housekeeping should not fail a good run.

Alerting reuses the scheduler rather than adding a delivery service: the collector process exits
non-zero when a run contains a hard failure (an adapter error, a `failed` metric, or a `failed`
health check), which fails the scheduled workflow run and triggers GitHub's own failed-workflow
email. Warning-level results deliberately do not fail the run — a known warning that emails daily
is an alert the owner learns to ignore — so warnings stay confined to the dashboard's attention
panel and the workflow step summary. Snapshots are recorded before the exit code is set, so a
failing run still stores everything it collected.

Development flow: feature work happens on short-lived `feat/*` branches that merge into `dev` for
a combined manual check; the owner merges `dev` into `main` to trigger the production deploy.

The project documentation site (`site/`) deploys separately to GitHub Pages via
`.github/workflows/deploy-site.yml`, triggered by pushes to `main` that change `site/**` or
`docs/screenshots/**`.

## Dashboard Views

- Overview: each app with deploy status, uptime, domain/DNS health, current month cost estimate, and last sync.
- App detail: provider resources, recent snapshots, collector errors, and auth/data aggregate counts.
- Cost view: month-to-date cost by provider and service line, plus spend per day. Costs are never assigned to a project.
- OpenAI usage: account-level token, request, cached-token, and spend summary with API-key/model rows.
- GitHub Actions usage: repository-level latest run status, workflow runs, failures, scheduled-run counts, and runtime duration totals.
- Collector diagnostics/settings: connection status, last synced time, missing credentials, and collector summaries.
- Login gate: blocks dashboard rendering and data reads until Supabase Auth confirms an allowed owner email.

## Cost Strategy

- Track apps where they already run; the dashboard adapts to the apps, not the other way around.
- Use Supabase for this tool's auth/database and static hosting for the frontend.
- Avoid high-frequency observability or always-on infrastructure.
- Use daily cost snapshots before adding deeper monitoring.
- Keep provider costs account-level rather than guessing per-project splits. Providers bill by service; splitting a shared Amplify or EC2 line between apps would be invention, so `CollectorCost` has no project field at all.
- Do not migrate tracked apps unless collected metrics prove it is worth it.

## Security And Data Handling

- Treat all provider credentials as secrets.
- Never commit `.env` files or real tokens.
- Keep the hub's Supabase credentials separate from every tracked app's credentials. The hub JWT service-role key writes dashboard data; a watched app's credentials are used only for aggregate RPCs or aggregate views in that app's own project.
- Prefer read-only provider credentials for collectors.
- Use least privilege IAM permissions for AWS collection.
- Require Supabase Auth before dashboard data renders in the frontend.
- Keep a `dashboard_users` allowlist in Supabase and enforce read access with RLS.
- Use `VITE_DASHBOARD_ALLOWED_EMAIL` only as a frontend gate. Treat Supabase RLS as the durable data boundary.
- Store only aggregate metrics and operational state.
- Do not copy raw app user data or private records of any kind.
- For app-owned databases, use count-only RPCs, aggregate views, or provider metadata. Do not dump app tables into this project.
- For Resend, store aggregate operational metrics only, such as send counts, delivery status counts, bounce/error counts, domain verification status, and last successful send check. Do not store recipient addresses, email content, verification URLs, or tokens.
- If credential rotation or multi-user access becomes necessary, evaluate Supabase Vault or another secret manager.
