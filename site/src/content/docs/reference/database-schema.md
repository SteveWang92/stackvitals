---
title: Database Schema
description: Overview of the Supabase Postgres schema used by StackVitals.
---

StackVitals uses Supabase Postgres with migrations applied from `supabase/migrations/*.sql` in
numeric order.

## Core tables

| Table | Purpose |
|---|---|
| `projects` | One row per tracked app, keyed by a free-form `slug` matching the collector config |
| `providers` | Provider registry — `aws`, `amplify`, `supabase`, `resend`, `openai`, `github`, `cloudflare` |
| `resources` | Provider resources — deployments, domains, databases, API accounts, etc. |
| `metric_snapshots` | Status, counts, usage, latency, and deploy state over time |
| `cost_snapshots` | Daily or monthly cost by provider/service; account-level by default |
| `health_checks` | Uptime, HTTP status, response time, and last successful check |
| `collector_runs` | Audit trail for each collection run, including errors |
| `dashboard_users` | Email allowlist for RLS-based access control |

## Key design decisions

### Append-only snapshots

`metric_snapshots`, `cost_snapshots`, and `health_checks` are append-only. The read layer picks
the latest per logical key rather than updating in place. This preserves history and avoids
update conflicts.

### Account-level costs

Cost rows stay account-level (`project_id` null) unless a collector can map a cost to a specific
project. The dashboard does not guess per-project cost splits.

### Provider slugs

`projects.slug` is a free-form string that must match the slugs in `projects.config.json`.
`providers.key` maps to the `ProviderKey` TypeScript type. New provider keys are added together
with their collector adapter, never ahead of it.

### Project-scoped resources

Resource identity includes `project_id`, so one physical provider resource can appear in more
than one configured project. Account-level resources remain unique with a null project.

### RLS

Row-level security restricts all reads to authenticated users whose email appears in
`dashboard_users`. This is the durable data boundary — the frontend email allowlist
(`VITE_DASHBOARD_ALLOWED_EMAIL`) is an additional gate, not a replacement.

## Migrations

Migrations are applied in numeric order from `supabase/migrations/`:

1. Core schema (projects, providers, resources, snapshots, health checks, collector runs)
2. Dashboard users table + RLS policies
3. GitHub Actions provider registration
4. Table privileges required by a from-scratch local Supabase stack
5. Optional project-card sort order
6. Removal of the unused cost-attribution column
7. Timestamp indexes supporting the 30-day history views
8. Removal of the retired Resend delivery metrics
9. Delete privileges for snapshot retention on local or explicitly provisioned databases
10. Project-scoped resource identity, allowing one provider resource in multiple projects

Run `npm run db:reset` to reapply all migrations and seeds from scratch during development.
Existing installations should apply every newer migration in order. Migration 008 removes retired
Resend rows, 009 enables retention deletes, and 010 prevents shared provider resources from
colliding across configured projects.
