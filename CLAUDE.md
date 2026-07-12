# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Private, single-owner operations dashboard for a handful of personal web projects. It surfaces deploy health, uptime, provider status, aggregate usage, OpenAI/GitHub Actions usage, collector errors, and month-to-date cost **without copying raw app data** out of the source projects. Two moving parts:

- A **Vite + React 19 + TypeScript** frontend (`src/App.tsx`, `src/services`, `src/lib`) that reads pre-aggregated rows from Supabase and renders them.
- A set of **Node collectors** (`src/collectors`) that call external provider APIs and write snapshots back into the same Supabase project. Collectors run on a schedule from GitHub Actions, not in the browser.

`docs/STACKVITALS_PLAN.md` records product scope, architecture, data-safety rules, and cost strategy — a reference for the current system, not a roadmap. If a change alters any of those, update that doc in the same change.

## Commands

```bash
npm run dev          # Vite dev server (frontend)
npm run build        # tsc -b then vite build
npm test             # vitest run (all tests, no watch)
npm run lint         # eslint .
npm run format       # prettier --write .

npm run collect:http     # scripts/manual-http-health.mjs — quick public-URL health probe only
npm run collect:status   # runs ALL configured collectors via vite-node

npm run demo:screenshots # 1080p demo screenshots via scripts/demo-screenshots/capture.mjs (VITE_DEMO_MODE, fictional data, no auth)
```

Run a single test file: `npx vitest run src/tests/services/dashboardData.test.ts`. Filter by name: `npx vitest run -t "openai"`. Vitest globals (`describe`, `it`, `expect`) are enabled — tests don't import them.

Commits are Conventional Commits, enforced by commitlint + Husky (`commitlint.config.cjs`), and stay to a single `type: description` line — no body/description paragraph unless the user asks for more detail. Prettier uses single quotes and `printWidth: 140`.

## Architecture

### Collector pipeline (the core abstraction)

Everything flows through the `ProviderAdapter` contract in `src/collectors/types.ts`. Each provider implements `collect(context) => Promise<CollectorAdapterResult>`, returning a uniform shape: `resources`, `metrics`, `costs`, `healthChecks`, `errors`, plus a `status` (`success | partial_success | skipped | failed`).

- **`runCollectors.ts`** runs adapters sequentially, catches thrown adapter errors (converting them to a `failed` result rather than aborting the run), optionally hands each result to a `CollectorRunRecorder`, and derives an overall run status.
- **`runConfiguredCollectors.ts`** is the entry point (`collect:status`). It is the **one place** that reads env vars and `projects.config.json`, then conditionally assembles the adapter list — an adapter is only added if its credentials are present. This is where you wire up a new provider.
- **`stores/supabaseCollectorRunRecorder.ts`** maps `CollectorAdapterResult` into the DB tables (`resources`, `metric_snapshots`, `cost_snapshots`, `health_checks`, `collector_runs`), resolving provider/project slugs to UUIDs with an in-memory cache.

**Dependency injection is the testing seam.** Adapters (`providers/*.ts`) never construct their own network clients. They receive a client interface, and the live implementations live separately in `liveClients/*.ts` (e.g. `providers/githubActions.ts` takes a client; `liveClients/github.ts` builds the real one). Tests inject fakes. When adding a provider, follow this split: pure adapter logic in `providers/`, real API calls isolated in `liveClients/`.

Adding a provider generally means: extend `ProviderKey` in `src/types.ts`, add a `providers/x.ts` adapter + `liveClients/x.ts`, wire it into `runConfiguredCollectors.ts` behind its credential check, add a label in `providerLabels` / icon in `App.tsx`, and add a mocked test under `src/tests/collectors/providers/`.

### Frontend read path

`src/services/dashboardData.ts` is the heart of the read side. `fetchDashboardData(client)` issues parallel Supabase selects, then does substantial **client-side aggregation**: dedup-to-latest per key, month-to-date vs. last-month cost bounds, OpenAI usage roll-ups, GitHub Actions summaries, per-project provider status, and collector-error scoping (errors are suppressed once a newer successful run exists for that provider). The raw DB `snake_case` row shapes are defined here as interfaces; the app-facing `camelCase` types live in `src/types.ts`. `App.tsx` is a single large component that renders the returned `DashboardData` across tabs (Detail / Collectors / Usage / Costs).

### Data model

Supabase Postgres, schema in `supabase/migrations/*.sql` (applied in numeric order). Core tables: `projects`, `providers` (lookup), `resources`, `metric_snapshots`, `cost_snapshots`, `health_checks`, `collector_runs`. Snapshots are **append-only** — the read layer picks the latest per logical key rather than updating in place. `projects.slug` is a free-form string that must match the slugs in the collector config; `providers.key` maps to `ProviderKey`.

## Security & data boundaries (non-negotiable)

- **Never commit** provider credentials, API keys, AWS secrets, Supabase service-role keys, `.env`, `projects.config.json` (contains real resource IDs), or `supabase/seed.local.sql` (real project rows). `projects.example.json` is the safe committed template.
- **Separate Supabase projects, separate keys.** `HUB_SUPABASE_JWT_SERVICE_ROLE_KEY` writes collector results into *this* dashboard's Supabase. A watched app's service-role key is used only to call count-only aggregate RPCs in that app's own project — never to read raw records. Collect aggregate operational metrics only; never copy raw app user data into this tool.
- Collector/service secrets must never reach the frontend (only `VITE_*` env is exposed to the browser).
- Access is gated twice: frontend login before data renders (`src/lib/supabase.ts`, allow-listed via `VITE_DASHBOARD_ALLOWED_EMAIL`) and Supabase RLS restricting reads to authenticated emails in `public.dashboard_users` (`migrations/002`).

## Deployment & runtime

- **Amplify deploys from `main`.** The scheduled collector GitHub Action (`.github/workflows/collect.yml`) also runs only from `main` (guarded by `if: github.ref == 'refs/heads/main'`), on a daily cron. Its secrets are the canonical list of what each collector needs.
- Keep it low-cost by default: no always-on services, paid monitoring, or extra hosting unless the plan or user explicitly calls for it.

## Working conventions (from the previous AGENTS.md)

General commit, branch, reuse, and working rules live in the user-global `~/.claude/CLAUDE.md`. Project-specific:

- Add mocked tests for provider adapters before relying on live provider APIs.
- Tests live under `src/tests/` mirroring the source tree — do **not** colocate `*.test.ts` beside implementation files.
- No `release:tag` script here — release via the squash-merge `dev`→`main` PR using the **`/release` skill**, which also moves the `Unreleased` section of `CHANGELOG.md` into the new version and publishes the GitHub release after tagging.
- Notable user-facing changes land in the `Unreleased` section of `CHANGELOG.md` in the same change that makes them. Use the **`changelog` skill** (`.claude/skills/changelog/`) for how to write entries (net change, noise filtering, Keep a Changelog categories).
- This folder is a standalone project; do not touch `D:\Projects\Integration-Dashboard`.
