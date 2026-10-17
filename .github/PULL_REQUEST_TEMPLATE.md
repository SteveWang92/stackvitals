## What this changes

<!-- The net effect, in a sentence or two. Link the issue if there is one. -->

## Why

<!-- The operational question this answers, or the bug it fixes. -->

## Checklist

- [ ] `npm test`, `npm run lint`, and `npm run build` pass locally
- [ ] Commits follow Conventional Commits (enforced by commitlint)
- [ ] `CHANGELOG.md` `[Unreleased]` updated, or this change is not user-facing
- [ ] `docs/STACKVITALS_PLAN.md` updated if scope, architecture, data boundaries, or deployment
      assumptions changed

### For a new provider adapter

- [ ] Adapter logic in `providers/`, real network calls isolated in `liveClients/`
- [ ] Mocked test under `src/tests/collectors/providers/` — no test hits a live API
- [ ] Collects aggregate/operational data only; no raw records from the watched app
- [ ] Works with read-only credentials, and is skipped when its credentials are absent

### Secrets

- [ ] No credentials, tokens, real resource IDs, or `.env` contents in the diff or the
      description
