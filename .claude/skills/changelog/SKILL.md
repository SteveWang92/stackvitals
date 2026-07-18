---
name: changelog
description: Write and curate CHANGELOG.md entries for this repo. Use when adding a changelog entry, preparing release notes, or summarizing a range of commits/PRs into user-facing notes. Adapts the "net-change, noise-filtered, well-attributed" changelog discipline to this project's Keep a Changelog + [Unreleased] + /release conventions.
---

# Changelog authoring

This project keeps a single `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format with an `[Unreleased]` section at the top and Semantic Versioning. Notable user-facing
changes land in `[Unreleased]` **in the same change that makes them**. The release script
(`npm run release:ship`) moves `[Unreleased]` into a new dated `vX.Y.Z` section at release
time and updates the compare links — do not hand-cut version sections here.

This skill is the *how to write a good entry* layer. It adapts a battle-tested changelog
discipline (net change, noise filtering, attribution) to this repo. Project rules win wherever
they differ from the source discipline.

## Structure (do not change)

- One file, newest first: `[Unreleased]` → `[1.2.0] - YYYY-MM-DD` → older.
- Category order under each version: **Added, Changed, Deprecated, Removed, Fixed, Security**
  (Keep a Changelog's set — *not* New/Improved/Fix). Omit empty categories.
- `*`/`-` list items match the existing file (this repo uses `-`). English only.
- Bottom-of-file compare links are maintained by `/release`; leave them alone when only
  editing `[Unreleased]`.

## 1. Net change, not commit log

Consolidate every commit that touches one feature/fix into a **single entry describing the
final state**, not the journey. If a change was added then reworked across three commits, the
changelog gets one line for what shipped.

- Rewrite vague, jokey, or colloquial commit subjects into a clear user-facing sentence —
  read the diff if the subject doesn't tell you what actually changed.
- Reverts: if fully reverted within the range, drop both entries; if partially retained,
  write one entry for the net result.
- Describe the effect on the user/operator, not the implementation ("Supabase adapters that
  share one provider key no longer mask each other's run results" — not "refactored recorder
  dedup key").

## 2. Noise filtering

Leave these out of the changelog unless the diff proves a user-facing effect:

- Pure `chore`/`ci`/`build`/`style`/`test` churn, formatting, lint, typo, comment, and
  "fix review feedback" commits.
- Version bumps, `Release vX.Y.Z`, and changelog-update commits themselves.
- Bot/automation commits.
- Anything whose commit body says `[skip changelog]`.

Do **not** blanket-drop `perf`/`chore`: keep them when the user perceives the result
(faster load, less flakiness, lower cost, fewer collector failures).

## 3. Attribution (when notes reference contributors)

Day-to-day solo commits need no attribution. When crediting an external contributor or citing
a PR:

- Take the author from the commit author (`git log --format=%an`), **never** the committer —
  squash-merges record the maintainer as committer, which would miscredit the change.
- For a multi-contributor PR, open the PR page to confirm everyone and list them
  space-separated (`@alice @bob`).
- Link PRs as `([#123](https://github.com/SteveWang92/stackvitals/pull/123))`.

## 4. Wording

- One line per change, independently understandable without reading other entries or prior
  versions. No duplication of something already published in an earlier version section.
- Present tense, imperative-ish result ("Add…", "Fix…", "Remove…") consistent with the
  existing entries.
- Name the user-facing knob when relevant (env var, config field, flag) in backticks.
- Respect the project's data-safety framing: describe aggregate/operational effects, never
  imply raw app data is collected.

## Deliberately NOT used here

The source discipline this skill is adapted from targets a bilingual, multi-server desktop app
with alpha/beta channels. Those mechanics do **not** apply to this project and must not be
introduced:

- No bilingual entries or `Highlights` blocks — English only.
- No `-alpha`/`-beta` pre-releases and no `<details>` collapsible version blocks — this is a
  self-hosted app, not a distributed package; every release is stable.
- Versioning follows the git tag / `/release` flow (annotated `vX.Y.Z` tags on `main` are the
  source of truth) — do not try to derive or "correct" versions from PR titles.
- No sub-repository sections, no per-server splitting.

## Checklist before finishing

- [ ] Related commits consolidated to net change; noise removed.
- [ ] Correct Keep a Changelog category; empty categories omitted.
- [ ] Entry is user-facing and self-contained; no duplication of a published version.
- [ ] Landed in `[Unreleased]` (never a hand-made version heading).
- [ ] Compare links untouched (that's `release:ship`'s job).
