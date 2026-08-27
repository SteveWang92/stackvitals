# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release
is tagged `vX.Y.Z` on `main` and published as a GitHub release with the matching section
below as its notes.

## [Unreleased]

## [1.7.2] - 2026-08-28

### Fixed

- Collector writes now require `HUB_SUPABASE_SECRET_KEY` with a Supabase `sb_secret_` key for privileged REST access. Rename the previous Hub secret before the next collector run.


## [1.7.1] - 2026-08-28

### Fixed

- Collector writes and snapshot pruning now work with Supabase `sb_secret_` keys instead of failing with `PGRST301` JWT errors.


## [1.7.0] - 2026-08-27

### Changed

- Collector writes now accept Supabase `sb_secret_` keys as well as legacy JWT service-role keys, so self-hosters can migrate to the current API key system.


## [1.6.1] - 2026-08-23

### Fixed

- The dashboard no longer refuses to render the whole page when a snapshot row carries a status the
  frontend does not recognise.
- The project site now documents the current Node.js requirement, deploy adapters, AWS backend collector, database migrations, and read architecture.


## [1.6.0] - 2026-08-23

### Added

- Collector support for apps whose auth and data live on AWS primitives: set `cognitoUserPoolId`,
  `dynamoDbTables` and an optional `awsBackendRegion` on a project and the dashboard reports the
  Cognito user pool's availability and estimated user count beside each DynamoDB table's status,
  item count and size. The collector's AWS credentials need read-only `cognito-idp:DescribeUserPool`
  and `dynamodb:DescribeTable` on the configured ARNs.
- `collect:status` now exits non-zero when a run contains a hard failure, so a scheduled GitHub
  Actions run is marked failed and GitHub's own failed-workflow email becomes the alerting path.
- Snapshot retention: each collector run now deletes snapshot, cost, health-check and collector-run
  rows older than `SNAPSHOT_RETENTION_DAYS` (default 90, minimum 31).
- Cost Explorer collection can be turned off with `"aws": { "costExplorerEnabled": false }` in the
  collector config, for AWS credentials that intentionally omit `ce:GetCostAndUsage`.

### Changed

- The supported Node.js version is now 24.18.1. Self-hosters building from source need Node 24;
  Node 22 is no longer tested.

### Removed

- The `resend_verification_email_*_count` metrics, which always reported zero, and the
  `resendVerificationCategory` config field that selected them. Self-hosters should apply migration
  `008_drop_resend_delivery_metrics.sql` to delete the retired rows.

### Fixed

- A provider whose stored sync timestamp could not be parsed no longer crashes the dashboard render.
- A provider now reports the worst status among the resources it is still collecting, instead of
  whichever reading happened to be written last or a resource that has since been removed.

### Security

- Updated the transitive `nanoid` and `js-yaml` build dependencies to patched releases.


## [1.5.0] - 2026-07-30

### Added

- "Needs Attention" panel listing each failing or warning check with its project, provider, and
  error detail; each row opens that project's detail view. Providers that have simply gone quiet
  are counted separately from failures.
- 30-day history on project cards and in App Detail: a median response-time sparkline and a daily
  uptime strip. A day the collector never ran shows as no-data, not an outage.
- Daily spend chart on the Costs tab, and usage trend charts for OpenAI tokens and GitHub Actions
  runtime minutes on the Usage tab.
- Staleness badge on provider rows showing how old a collector's data is, while the status pill
  keeps reporting the last known state.
- "Stack Status Hub" subtitle in the dashboard header and sign-in screen, the browser tab title,
  and the landing pages (English and Chinese).
- `npm run db:up` — one command for a local Supabase stack, dashboard login user, and a
  git-ignored `.env.local`. Also `db:down`, `db:reset`, and `dev:local`.
- `npm run db:up:demo` seeds the local database with fictional data covering every dashboard
  state. Also `db:reset:demo` and `db:demo`.
- Migration `007_history_indexes.sql` adds timestamp indexes to `health_checks`,
  `metric_snapshots`, and `cost_snapshots`. Self-hosters should apply it; the dashboard works
  without it, just slower.
- CI builds the docs site on every pull request.

### Changed

- Timestamps use a 24-hour clock.
- Costs are account-level throughout: `CollectorCost` drops its project field and the Costs tab no
  longer filters by project. No adapter ever wrote a per-project cost. The
  `cost_snapshots.project_id` column stays for a future allocation scheme.
- Data is considered stale after 36 hours instead of 24, so ordinary drift in the daily collector
  schedule no longer trips it.

### Fixed

- A provider known only from a resource-inventory row reported as "Healthy". It now reports
  "Unknown" until a health check or metric arrives.

### Security

- Upgraded `vitest` 4, `eslint` 10, `astro` 7, `@astrojs/starlight`, and `sharp` 0.35 to clear all
  open advisories in the dashboard and the docs site. None of these ship in the deployed bundle.


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

[Unreleased]: https://github.com/SteveWang92/stackvitals/compare/v1.7.2...HEAD
[1.7.2]: https://github.com/SteveWang92/stackvitals/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/SteveWang92/stackvitals/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/SteveWang92/stackvitals/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/SteveWang92/stackvitals/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/SteveWang92/stackvitals/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/SteveWang92/stackvitals/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/SteveWang92/stackvitals/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/SteveWang92/stackvitals/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/SteveWang92/stackvitals/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/SteveWang92/stackvitals/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SteveWang92/stackvitals/releases/tag/v1.0.0
