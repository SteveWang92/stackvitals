# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release
is tagged `vX.Y.Z` on `main` and published as a GitHub release with the matching section
below as its notes.

## [Unreleased]

### Fixed

- A provider known only from a resource-inventory row reported as "Healthy" even though no
  health check or metric had ever confirmed it. Existence is not health; such a provider now
  reports "Unknown" until a check or metric arrives.

### Added

- `npm run db:up` sets up local development in one command: starts Docker Desktop if it isn't
  running, boots the local Supabase stack, creates the dashboard login user and its allow-list
  row, and writes the local URL and keys to a git-ignored `.env.local`. `db:down`, `db:reset`,
  and `dev:local` round it out. Replaces the manual `npx supabase start` + `curl` + SQL steps in
  the self-hosting guide, and works with the Supabase CLI installed locally, globally, or not at
  all.
- "Stack Status Hub" subtitle alongside the product name in the dashboard header and sign-in
  screen, the browser tab title, and the landing page, with a localized equivalent on the
  Chinese landing page.
- "Needs Attention" panel below the summary row naming each failing or warning check, with the
  project, provider, and the actual failure detail. The summary tile counted these but never said
  what was wrong; each row now jumps straight to that project's detail view. Providers that have
  simply gone quiet are reported separately, so a silent collector is not confused with a failure.
- 30-day history on each project card and in App Detail: a median-response-time sparkline and a
  daily uptime strip, so a project reads as "healthy, and trending this way" rather than just
  "healthy right now". A day the collector never ran is shown as an explicit no-data cell rather
  than an outage. Rendered as inline SVG — no charting dependency was added.
- Cumulative month-to-date spend line on the Costs tab, scoped to the current billing period.
- Staleness badge on provider rows in App Detail and Provider Settings. A collector that
  silently stops no longer leaves a confident green status with no indication of its age; the
  badge shows how old the data is while the status pill keeps reporting the last known state.
  The stale threshold is now 36 hours rather than 24, so ordinary drift in the daily collector
  schedule no longer trips it.
- Migration `007_history_indexes.sql` adds timestamp indexes to `health_checks`,
  `metric_snapshots`, and `cost_snapshots`. The dashboard's fleet-wide reads sort by
  timestamp without a project filter, which the existing `project_id`-leading indexes cannot
  serve. Self-hosters should apply this migration; the dashboard works without it, just slower.

## [1.4.0] - 2026-07-19

### Added

- Deploy status for projects deployed via a GitHub Actions workflow (e.g. GitHub Pages):
  set `githubDeployWorkflow` in the collector config to report that workflow's latest run
  as the project's deploy status, alongside the existing Amplify-based deploy status.
- Deploy status for Cloudflare Pages projects: set `cloudflarePagesProject` in the
  collector config to report the latest production deployment status, using the same
  Cloudflare API token and account ID as the domain collector.

### Fixed

- Cloudflare Pages deploy status could report "no production deployments" when 5+ preview
  deployments pushed the production deployment out of the API page; now uses server-side
  environment filtering.
- A transient error from the GitHub Actions deploy-workflow API could discard all
  successfully-fetched workflow-run data for that repository; the deploy-workflow call is
  now isolated so general CI metrics survive independently.


## [1.3.0] - 2026-07-17

### Added

- Live Demo link to the hosted demo at [stackvitals.app](https://stackvitals.app) on the
  project-site landing page (English and Chinese).

### Changed

- Show CI and docs-deploy status badges at the top of the README instead of the bare
  stackvitals.dev link.

## [1.2.0] - 2026-07-16

### Added

- Chinese (zh-CN) documentation for the project site, covering all guides, references, and about pages.
- Demo badge next to the brand heading when the dashboard is running in demo mode.
- Docs link in the site header navigation.

### Fixed

- Escape backslashes in GitHub Actions step summary table cells so Markdown renders correctly.

### Changed

- Use colored logo in the project site instead of monochrome.

## [1.1.0] - 2026-07-14

### Added

- Project site with landing page and docs, built with Astro Starlight in `site/`, deployed to
  GitHub Pages at [stackvitals.dev](https://stackvitals.dev).
- `dev:demo` script for running the dev server with fictional demo data and no auth required.

### Changed

- Replace logo with stack-and-heartbeat design and update favicon to match.

## [1.0.0] - 2026-07-12

Initial public release of StackVitals — a self-hosted, single-owner operations dashboard
that surfaces uptime, deploy health, provider status, month-to-date cloud cost, and AI/CI
usage for a handful of personal web projects, without copying raw app data out of the
source projects.

### Added

- Vite + React + TypeScript frontend that reads pre-aggregated rows from Supabase and renders
  deploy health, uptime, provider status, domain health, usage roll-ups, collector
  diagnostics, and month-to-date vs. last-month cost across Detail / Collectors / Usage /
  Costs tabs.
- Node collector pipeline built on a single `ProviderAdapter` contract, run on a schedule
  from GitHub Actions, writing append-only snapshots back to Supabase.
- Collector adapters: HTTP health, AWS Amplify deploy status, AWS Cost Explorer, Supabase
  project health, watched-app Supabase aggregates (count-only RPC — never raw records),
  Resend domain verification, OpenAI usage, GitHub Actions usage, and Cloudflare domains.
- Config-driven, à-la-carte setup: adapters activate only when their credentials are present,
  and `projects.config.json` resolves `${ENV_VAR}` placeholders so no secrets or real
  resource ids are committed. Cloudflare domain groups may omit `projectSlug` to stay
  account-level.
- Single-owner access model: a comma-separated email allowlist gates the frontend and
  Supabase RLS restricts reads to allow-listed accounts.
- Demo mode (`VITE_DEMO_MODE`) with fictional data and a screenshot capture script for
  auth-free public screenshots.
- CI workflow (tests, lint, build) and a scheduled collector workflow, both writing a summary
  to the GitHub Actions job summary.
- Self-hosting guide and contributing guide (including how to add a new adapter).

[Unreleased]: https://github.com/SteveWang92/stackvitals/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/SteveWang92/stackvitals/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/SteveWang92/stackvitals/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/SteveWang92/stackvitals/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/SteveWang92/stackvitals/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SteveWang92/stackvitals/releases/tag/v1.0.0
