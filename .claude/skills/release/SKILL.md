---
name: release
description: Run the two-phase release workflow for StackVitals. Use when the user wants to cut a release, prep a release PR, ship a release, or says "release this" / "make a release".
---

# Release workflow

StackVitals uses a two-phase release script at `scripts/release.mjs`. Both phases are
non-interactive — no TTY prompts, safe for AI execution.

## Prerequisites

- You are on the `dev` branch with a clean working tree.
- `CHANGELOG.md` has entries under `[Unreleased]`. Every notable change should already be
  there — entries land in the same commit that makes them (see the `changelog` skill).
- `gh` CLI is authenticated.

## Phase 1 — prep

Creates the release PR from `dev` → `main`.

```bash
node scripts/release.mjs prep [--version X.Y.Z] [--dry-run]
```

The script:
1. Fetches origin and fast-forwards dev.
2. Reads `[Unreleased]` from `CHANGELOG.md` (aborts if empty).
3. Auto-detects the version from conventional commits (or uses `--version`).
4. Pushes dev to origin.
5. Creates a PR titled "Release vX.Y.Z" with the unreleased changelog as body.
6. Prints the PR URL and the exact `ship` command to run next.

If the user doesn't specify `--version`, the script suggests one based on commit types
(feat → minor, fix → patch, breaking → major). The user can override.

## Phase 2 — review (manual)

This is the only step that requires human judgment:

1. Review the PR (use `/code-review` on the PR, or review the diff manually).
2. Fix any issues found during review — commit fixes to `dev` and push.
3. Once satisfied, proceed to ship.

## Phase 3 — ship

Finalizes and publishes the release.

```bash
node scripts/release.mjs ship [--version X.Y.Z] [--dry-run]
```

The script:
1. Fetches origin and fast-forwards dev.
2. Finds the open release PR (dev → main).
3. Reads the version from the PR title (or uses `--version`).
4. Bumps `version` in `package.json` and `package-lock.json`.
5. Moves `[Unreleased]` in `CHANGELOG.md` to a dated `[X.Y.Z]` section and updates
   compare links.
6. Commits `chore(release): vX.Y.Z` and pushes dev.
7. Squash-merges the PR (commit title: `chore(release): vX.Y.Z`, empty body).
8. Checks out main, pulls, creates an annotated `vX.Y.Z` tag, pushes it.
9. Creates a GitHub release with the changelog section as notes.
10. Resets dev to main and force-pushes.

## AI execution

When running a release as AI:

1. Run `node scripts/release.mjs prep --version X.Y.Z` (or let it auto-detect).
2. Run `/code-review` on the created PR. Fix issues, commit, push.
3. Run `node scripts/release.mjs ship --version X.Y.Z`.

Use `--dry-run` on either phase to preview without side effects.

## Important notes

- The PR title is "Release vX.Y.Z" (human-readable); the squash commit uses
  `chore(release): vX.Y.Z` (conventional commit).
- `ship` pushes the tag and force-pushes dev — these are the only pushes in the workflow
  and are explicitly authorized by the release script.
- After ship completes, dev and main are identical and the tag is on main's HEAD.
