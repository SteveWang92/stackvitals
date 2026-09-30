# Contributing

This is a small, config-driven dashboard template. Contributions that add a new provider
adapter, fix a bug, or improve docs are welcome. Contributions that add multi-tenant auth, a
plugin marketplace, or other scope well beyond "single-owner ops dashboard" are probably better
as a fork — open an issue first if you're unsure.

## Repo conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/), one line, no body
  unless there's a reason (`feat: add cloudflare domains adapter`, `fix: handle empty github
  runs`). Enforced by commitlint + Husky on commit.
- **Tests**: live under `src/tests/`, mirroring the source tree — do not colocate `*.test.ts`
  beside implementation files. Run with `npm test` (vitest). There is no vitest config file and
  globals are **off**, so import `describe`, `it`, `expect`, and `vi` from `vitest` in every test.
  Component tests additionally start with a `// @vitest-environment jsdom` pragma and assert with
  plain DOM checks — jest-dom's matchers would require a setup file, and therefore a config file.
- **Formatting/linting**: `npm run format` (Prettier, single quotes, `printWidth: 140`),
  `npm run lint` (ESLint). Both should pass before you open a PR.
- **Build**: `npm run build` (`tsc -b` then `vite build`) should pass.
- **CI**: `.github/workflows/ci.yml` runs `npm test`, `npm run lint`, and `npm run build` on
  every PR — a green local run of those three means a green PR.
- Add mocked tests for provider adapters before relying on live provider APIs — never gate a PR
  on hitting a real external service.

## Adding a provider adapter

Every provider follows the same shape, defined by the `ProviderAdapter` contract in
[`src/collectors/types.ts`](src/collectors/types.ts): a `collect(context)` function that returns
a uniform result — `resources`, `metrics`, `costs`, `healthChecks`, `errors`, and a `status`
(`success | partial_success | skipped | failed`).

**Dependency injection is the testing seam.** Adapters never construct their own network
clients — they receive a client interface, and the real implementation lives separately in
`liveClients/`. Tests inject fakes; nothing in `providers/` makes a real network call. Keep that
split when adding a new one.

Steps to add a provider, using an existing one (e.g. `src/collectors/providers/cloudflare.ts`)
as a reference:

1. **Extend `ProviderKey`** in [`src/types.ts`](src/types.ts) with your provider's key.
2. **Add `src/collectors/providers/<name>.ts`** — pure adapter logic. It takes a typed client
   interface as a constructor/factory argument and maps the client's response into the
   `CollectorAdapterResult` shape. No `fetch`, no SDK client construction, no env var reads here.
3. **Add `src/collectors/liveClients/<name>.ts`** — the real implementation of that client
   interface (the actual API/SDK calls, given credentials as plain arguments).
4. **Wire it into [`src/collectors/runConfiguredCollectors.ts`](src/collectors/runConfiguredCollectors.ts)**
   behind a credential check — the adapter should only be added to the run when its required env
   vars/config fields are present, so a fork with no credentials for your provider still runs
   cleanly. This file is the one place that reads env vars and `projects.config.json` to decide
   which adapters to instantiate.
5. **Add a label and icon** in `providerLabels` / the icon map in [`src/App.tsx`](src/App.tsx)
   so the frontend renders your provider's status nicely.
6. **Add a mocked test** under `src/tests/collectors/providers/<name>.test.ts` covering at least
   a success case, a partial/degraded case, and an error case, using a fake client — no real
   network calls in CI.
7. If your provider needs new credentials, document them in the config table and required-secrets
   list in [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md), and add the env var(s) to
   [`.env.example`](.env.example) with the right `[GITHUB]`/`[HOSTING]`/etc. tag.

## Data boundaries (non-negotiable)

This tool collects **aggregate operational signals only** — status, counts, durations, costs.
It never stores raw user data, request payloads, message bodies, or table dumps from a watched
app. A new adapter must not change that. See "Data boundaries" in
[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for the full list of what is and isn't collected.

## Security

Never commit credentials, API keys, service-role keys, `.env`, or `projects.config.json`
(real resource IDs). See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability.
