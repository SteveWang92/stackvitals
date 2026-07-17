# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release
is tagged `vX.Y.Z` on `main` and published as a GitHub release with the matching section
below as its notes.

## [Unreleased]

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

[Unreleased]: https://github.com/SteveWang92/stackvitals/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/SteveWang92/stackvitals/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/SteveWang92/stackvitals/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SteveWang92/stackvitals/releases/tag/v1.0.0
