---
type: card
title: Rename package (@4gpts/sil-openclaw on npm, sil on ClawHub) + klodi-style README + bump
slug: package-rename-and-klodi-readme
work_type: chore
tiers: [integration]
status: done
agents: []
priority: 1
created: 2026-06-11
updated: 2026-06-12
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-package-rename-and-klodi-readme
branch: card/package-rename-and-klodi-readme
pr: https://github.com/Context4GPTs/sil-openclaw/pull/16
merged_commit: 224351f2df7ca878e6d9497f28033d2b91c224b5
---

## Intent (founder)

The package was published as `@4gpts/sil` — wrong. This repo is `sil-openclaw`, the
OpenClaw plugin for sil. Fix the names:

- **npm:** `@4gpts/sil-openclaw` — npm has no implicit OpenClaw context, so the name
  carries the `-openclaw` suffix (matches the repo).
- **ClawHub:** `sil` — ClawHub *is* the OpenClaw registry, so the suffix is redundant;
  publish it directly as `sil` (the plugin's `openclaw.plugin.json#id`).

Also restyle the README after klodi's (install-first, tool surface, security, etc.) and
bump the version (0.1.0 → 0.2.0). Then republish under the corrected names and retire the
mistaken `@4gpts/sil` on both registries.

## Discovery findings — founder-direct

### Approach
- npm distribution name and ClawHub package name **diverge by design**: `@4gpts/sil-openclaw`
  (npm) vs `sil` (ClawHub). `release.mjs` passes `--name <openclaw.plugin.json#id>` so the
  ClawHub name tracks the plugin id, decoupled from the npm scope/suffix.
- README rewritten to mirror `klodi/klodi-plugin/adapters/openclaw/README.md`.

### Affected files
- `package.json` — `name`, `openclaw.install.npmSpec`.
- `scripts/release.mjs` — ClawHub `--name` from the manifest id.
- `README.md` — klodi-style rewrite.
- `CHANGELOG.md` — `[Unreleased]` rename entry.
- `docs/decisions/sil-release-publish.md`, `CLAUDE.md` — name references.

### Risks
- ClawHub may not accept a bare (unscoped) `sil` under owner `4gpts` — verified by `release:dry`
  before any real publish.
- The mistaken `@4gpts/sil@0.1.0` must be retired (npm unpublish < 72h; ClawHub hide) post-republish.

### Acceptance
- `release:dry` resolves npm name `@4gpts/sil-openclaw` and ClawHub name `sil`; manifest-contract
  + version-parity tests stay green.

## In Dev — founder-direct
