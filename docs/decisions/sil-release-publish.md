---
id: sil-release-publish
title: Release model — one source-of-truth version, two-step bump→publish, one tarball to npm + ClawHub
tags: [build, release, publish, npm, clawhub, versioning]
card: publish-to-npm-clawhub
updated_at: 2026-06-11
updated_by_card: publish-to-npm-clawhub
---

`@4gpts/sil` publishes to **two registries** — npm (`@4gpts/sil`) and ClawHub (the `code-plugin` family). The release machinery is the minimal production-grade equivalent of the klodi OpenClaw adapter's, stripped of the monorepo's staging dir and vendoring (this repo is one flat package with one real runtime dep). Four decisions constrain all future release work.

## 1. `package.json#version` is the single source of truth; the manifest is mirrored

The plugin carries its version in **two** files: `package.json#version` and `openclaw.plugin.json#version`. They MUST agree (ClawHub and the host read the manifest; npm reads package.json). Rather than maintain both by hand — klodi does, and its `stamp-version` script only rewrites pinned URLs, leaving the manifest version a **manual, drift-prone edit** — `scripts/sync-version.mjs` makes package.json authoritative and mirrors its version into the manifest (in-place string edit, one-line diff, re-parsed to prove the edit landed on the top-level key).

> **The guard:** `version parity` in `package-manifest.integration.test.ts` fails if the two ever drift. Never hand-edit `openclaw.plugin.json#version` — bump `package.json` (via `pnpm version`) and let the sync run.

## 2. Two steps, on the native npm lifecycle — not one hand-rolled script

Releasing is **bump** then **publish**, deliberately separate:

| Step | Command | Mechanism |
|---|---|---|
| Bump (every change) | `pnpm version patch\|minor\|major` | npm's `preversion` (typecheck + test) → bump → `version` (`sync-version` + `git add` the manifest) → commit + tag → `postversion` (`git push --follow-tags`) |
| Publish (when ready) | `pnpm release` (or `release:dry`) | `scripts/release.mjs` |

We lean on npm's `preversion`/`version`/`postversion` hooks rather than scripting git by hand — the bump's commit/tag/push is npm's job, and the `version` hook is the one sanctioned point to fold the manifest sync into the version commit. **One-shot `release <bump>` was rejected:** a mid-flight ClawHub failure would leave a half-released state (npm published + tag pushed, ClawHub not), and recovery is messy. Keeping publish re-runnable off an already-tagged commit is worth the second command.

## 3. Pack once, publish the identical tarball to both registries

`scripts/release.mjs` builds a clean `dist/`, runs `npm pack` **once**, then hands that one tarball to both `npm publish <tarball>` and `clawhub package publish <tarball>`. Both registries serve **the same bytes** — there is no separate per-registry build, so they cannot drift. Real publishes fail closed: the preflight requires a clean tree, HEAD tagged `v<version>`, a logged-in npm (`npm whoami`), and `clawhub` on PATH. `--dry-run` skips those gates (it is a pure preview) and uploads nothing. ClawHub attribution (`--owner`, `--source-repo`, `--source-commit`) is derived from `package.json#repository` + `git`. The owner defaults to the **`4gpts`** org (mirroring the `@4gpts` npm scope) and is overridable via `CLAWHUB_OWNER`; the publisher authenticates as an org member (`clawhub login` resolved `whoami` → `blackbak`), and `--owner 4gpts` is the publish-on-behalf-of-org form the `--owner` flag exists for.

## 5. Release notes flow through `CHANGELOG.md`

The changelog is [Keep a Changelog](https://keepachangelog.com/) format. `## [Unreleased]` accumulates as you work; the `version` lifecycle runs `scripts/changelog.mjs cut` to promote it to a dated `## [<version>]` section **inside the version commit**, and `release.mjs` reads that section (`changelog.mjs show <version>`) and passes it to `clawhub package publish --changelog`, so every ClawHub release carries its notes. `CHANGELOG.md` + `SECURITY.md` ship in the npm `files` allowlist (a `code-plugin` is judged on source provenance and scan state — `clawhub package readiness <name>` reports the blockers post-publish).

## 4. `build` cleans `dist/` first

`tsc` does **not** prune outputs orphaned by a deleted source — `dist/tools/examples.js` (from the removed skeleton tools) was still shipping in `npm pack` because `dist/` is gitignored and never rebuilt from scratch. `build` is now `pnpm clean && tsc` (clean = a zero-dep `node -e rmSync`), so the published tarball always matches the current source exactly. `prepack: pnpm build` is the backstop that keeps a bare `npm pack`/`npm publish` honest too.

## Not done (deferred)

CI publishing is a deliberate follow-up: both **npm provenance** (`npm publish --provenance`) and ClawHub **trusted publishing** (`clawhub package trusted-publisher`) require an OIDC-enabled CI (e.g. GitHub Actions on tag push) and so cannot be produced from a local publish. When that lands, a manual publish made while a trusted-publisher config exists will additionally need `clawhub package publish --manual-override-reason`. Today the flow is **local scripts only** (`npm login` + `clawhub login`, then `pnpm version …` / `pnpm release`). See [`README.md`](../../README.md#releasing) and [`CLAUDE.md`](../../CLAUDE.md#releasing) for the operator's guide.
