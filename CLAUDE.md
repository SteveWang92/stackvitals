# StackVitals

Repository-specific guidance for coding agents.

## What this is

StackVitals — an open-source (AGPL-3.0), self-hosted, single-owner operations dashboard for a handful of personal web projects. Public repo at `SteveWang92/stackvitals`; the docs/landing site in `site/` (Astro Starlight) deploys to GitHub Pages at **stackvitals.dev**. It surfaces deploy health, uptime, provider status, aggregate usage, OpenAI/GitHub Actions usage, collector errors, and month-to-date cost **without copying raw app data** out of the source projects. Two moving parts:

- A **Vite + React 19 + TypeScript** frontend (`src/App.tsx`, `src/services`, `src/lib`) that reads pre-aggregated rows from Supabase and renders them.
- A set of **Node collectors** (`src/collectors`) that call external provider APIs and write snapshots back into the same Supabase project. Collectors run on a schedule from GitHub Actions, not in the browser.

`docs/STACKVITALS_PLAN.md` records product scope, architecture, data-safety rules, and cost strategy — a reference for the current system, not a roadmap. If a change alters any of those, update that doc in the same change.

## Commands

```bash
npm run dev          # Vite dev server (frontend)
npm run db:up        # scripts/local-supabase.mjs — Docker + local Supabase stack + local login user
npm run db:down      # stop the local stack
npm run db:reset     # wipe local DB, re-apply migrations/seeds, re-provision the login user
npm run db:up:demo   # as db:up, plus fictional demo rows (scripts/demo-seed.mjs); also db:reset:demo, db:demo
npm run dev:local    # db:up then the dev server
npm run build        # tsc -b then vite build
npm test             # vitest run (all tests, no watch)
npm run lint         # eslint .
npm run format       # prettier --write .

npm run collect:http     # scripts/manual-http-health.mjs — quick public-URL health probe only
npm run collect:status   # runs ALL configured collectors via vite-node

npm run demo:screenshots # 1080p demo screenshots via scripts/demo-screenshots/capture.mjs (VITE_DEMO_MODE, fictional data, no auth)

npm run release:prep     # bump, finalize changelog, push dev, open/refresh release PR
npm run release:reversion -- X.Y.Z  # change a prepped release's version (files left uncommitted)
npm run release:ship     # verify the PR can merge, then squash-merge, tag, GitHub release
```

Run a single test file: `npx vitest run src/tests/services/dashboardData.test.ts`. Filter by name: `npx vitest run -t "openai"`. There is no Vitest config file and globals are off — every test imports `describe`, `it`, `expect`, and `vi` from `vitest` directly. Component tests under `src/tests/components/` opt into a DOM with a `// @vitest-environment jsdom` pragma on the first line rather than a config file, use `@testing-library/react`, and assert with plain DOM checks (`container.innerHTML`, `getAttribute`, `textContent`) — jest-dom's matchers would need a setup file, which would mean adding the config this repo does without.

Commits are Conventional Commits, enforced by commitlint + Husky (`commitlint.config.cjs`), and stay to a single `type: description` line — no body/description paragraph unless the user asks for more detail. Prettier uses single quotes and `printWidth: 140`.

## Architecture

### Collector pipeline (the core abstraction)

Everything flows through the `ProviderAdapter` contract in `src/collectors/types.ts`. Each provider implements `collect(context) => Promise<CollectorAdapterResult>`, returning a uniform shape: `resources`, `metrics`, `costs`, `healthChecks`, `errors`, plus a `status` (`success | partial_success | skipped | failed`).

- **`runCollectors.ts`** runs adapters sequentially, catches thrown adapter errors (converting them to a `failed` result rather than aborting the run), optionally hands each result to a `CollectorRunRecorder`, and derives an overall run status.
- **`runConfiguredCollectors.ts`** is the entry point (`collect:status`). It is the **one place** that reads env vars and `projects.config.json`, then conditionally assembles the adapter list — an adapter is only added if its credentials are present. This is where you wire up a new provider. The git-ignored `projects.config.json` is the machine-readable inventory for monitored projects: it owns their provider resource references, health-check URLs, and top-level `domains` groups. Add every new deployed environment there so the dashboard can collect it; `projects.example.json` owns only the safe public shape.
- **`stores/supabaseCollectorRunRecorder.ts`** maps `CollectorAdapterResult` into the DB tables (`resources`, `metric_snapshots`, `cost_snapshots`, `health_checks`, `collector_runs`), resolving provider/project slugs to UUIDs with an in-memory cache.

**Dependency injection is the testing seam.** Adapters (`providers/*.ts`) never construct their own network clients. They receive a client interface, and the live implementations live separately in `liveClients/*.ts` (e.g. `providers/githubActions.ts` takes a client; `liveClients/github.ts` builds the real one). Tests inject fakes. When adding a provider, follow this split: pure adapter logic in `providers/`, real API calls isolated in `liveClients/`.

Adding a provider generally means: extend `ProviderKey` in `src/types.ts`, add a `providers/x.ts` adapter + `liveClients/x.ts`, wire it into `runConfiguredCollectors.ts` behind its credential check, add a label in `providerLabels` / icon in `App.tsx`, and add a mocked test under `src/tests/collectors/providers/`.

### Frontend read path

`src/services/dashboardData.ts` is the heart of the read side. `fetchDashboardData(client)` issues parallel Supabase selects, then does substantial **client-side aggregation**: dedup-to-latest per key, month-to-date vs. last-month cost bounds, OpenAI usage roll-ups, GitHub Actions summaries, per-project provider status, and collector-error scoping (errors are suppressed once a newer successful run exists for that provider). The raw DB `snake_case` row shapes are defined here as interfaces; the app-facing `camelCase` types live in `src/types.ts`. `App.tsx` is a single large component that renders the returned `DashboardData` across tabs (Detail / Collectors / Usage / Costs).

There are two demo datasets and they are not interchangeable: `src/data/demoDashboardData.ts` is a ready-made `DashboardData` that `VITE_DEMO_MODE` swaps in for the read layer (screenshots, stackvitals.app), while `scripts/demo-seed.mjs` writes raw snapshot rows into the local Supabase (`npm run db:up:demo`) so local development exercises `fetchDashboardData` for real. Keep the fiction consistent between them; put new data-shape coverage in the seed.

### Data model

Supabase Postgres, schema in `supabase/migrations/*.sql` (applied in numeric order). Core tables: `projects`, `providers` (lookup), `resources`, `metric_snapshots`, `cost_snapshots`, `health_checks`, `collector_runs`. Snapshots are **append-only** — the read layer picks the latest per logical key rather than updating in place. `projects.slug` is a free-form string that must match the slugs in the collector config; `providers.key` maps to `ProviderKey`.

## Security & data boundaries (non-negotiable)

- **Never commit** provider credentials, API keys, AWS secrets, Supabase service-role keys, `.env`, `projects.config.json` (contains real resource IDs), or `supabase/seed.local.sql` (real project rows). `projects.example.json` is the safe committed template.
- **Separate Supabase projects, separate keys.** `HUB_SUPABASE_JWT_SERVICE_ROLE_KEY` writes collector results into *this* dashboard's Supabase. A watched app's service-role key is used only to call count-only aggregate RPCs in that app's own project — never to read raw records. Collect aggregate operational metrics only; never copy raw app user data into this tool.
- Collector/service secrets must never reach the frontend (only `VITE_*` env is exposed to the browser).
- Access is gated twice: frontend login before data renders (`src/lib/supabase.ts`, allow-listed via `VITE_DASHBOARD_ALLOWED_EMAIL`) and Supabase RLS restricting reads to authenticated emails in `public.dashboard_users` (`migrations/002`).

## Deployment & runtime

- **Amplify deploys from `main`.** The scheduled collector GitHub Action (`.github/workflows/collect.yml`) also runs only from `main` (guarded by `if: github.ref == 'refs/heads/main'`), on a daily cron. Its secrets are the canonical list of what each collector needs.
- The docs/landing site in `site/` deploys to GitHub Pages at **stackvitals.dev** via `.github/workflows/deploy-site.yml`. A demo-mode build (`VITE_DEMO_MODE=true`, fictional data, no auth) is hosted at **stackvitals.app**.
- **Checkout path constraint:** `npm run build` inside `site/` fails on a checkout whose absolute path contains an apostrophe — Expressive Code embeds the build path into a generated JS string and the apostrophe breaks the parse. Keep the local clone under an apostrophe-free path (it now lives under `D:\Projects\steve-projects\`). It never affected GitHub runners, and `ci.yml` builds `site/` on every PR regardless.
- **`vite-node` is a direct devDependency, pinned to 6.x.** `collect:status` runs the collectors through it, and it used to be available only because Vitest 2 depended on it — Vitest 4 dropped it, which would have silently broken the daily collector. 6.x requires Vite 8, so keep it in lockstep with Vite.
- Steve's production mirror and its deploy trigger are owned by the shared projects-root `CLAUDE.md`. This repository owns the manual `Mirror to project-status-hub` workflow; never do feature work or commit in the mirror repository.
- Keep it low-cost by default: no always-on services, paid monitoring, or extra hosting unless the plan or user explicitly calls for it.

## Working conventions

General commit, branch, reuse, and working rules live in the user-global `~/.claude/CLAUDE.md`. Project-specific:

- Add mocked tests for provider adapters before relying on live provider APIs.
- Tests live under `src/tests/` mirroring the source tree — do **not** colocate `*.test.ts` beside implementation files.
- Release uses `scripts/release.mjs` — a two-phase, non-interactive script. `npm run release:prep` bumps the version, finalizes `CHANGELOG.md`, pushes `dev` and opens the release PR, so the review and CI both run against the exact commit that will be tagged; it is idempotent, so re-run it after landing review fixes to refresh the PR. `npm run release:ship` pushes nothing: it verifies the PR can merge and fails without side effects if it cannot, then squash-merges, tags, and publishes the GitHub release. Follow the active `release` skill for the full workflow.
- Changing a prepped release's version — the review concludes it should be a minor, not a patch — is `npm run release:reversion -- X.Y.Z`. It rewrites all four places the version lives (version fields, changelog heading, compare links, PR title) and leaves the file changes uncommitted so they go in with the review fix that caused them. Never hand-edit those four places; `ship` refuses to merge when they disagree.
- `CHANGELOG.md` follows the changelog rules in Steve's global `CLAUDE.md`, which is where they are explained: user-facing results only, one entry to one line, Keep a Changelog categories in order.
- Two differences here. StackVitals is public and self-hosted, so an entry may carry a second sentence when it tells a self-hoster what they must **do** — apply a migration, add an IAM permission, change a config field — but never to explain the reasoning; such an entry wraps to the file's line width, since the one-line rule is about carrying one result, not about a character count. And the bottom compare links are left for `release:ship` to maintain.
- This folder is a standalone project; do not touch `D:\Projects\Integration-Dashboard`.
