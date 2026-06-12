---
type: card
title: Publish to npm + ClawHub with a version-bump cadence
slug: publish-to-npm-clawhub
work_type: chore
tiers: [integration]
status: done
agents: []
priority: 2
created: 2026-06-11
updated: 2026-06-12
base_branch: main
worktree: /Users/knitlybak/GitHub/4gpts/sil/sil-openclaw/.claude/worktrees/card-publish-to-npm-clawhub
branch: card/publish-to-npm-clawhub
pr: https://github.com/Context4GPTs/sil-openclaw/pull/15
merged_commit: cdb0e581d0337183e36023c4eed33d8cf5ffbd0c
---

## Intent (founder)

We want to publish `@4gpts/sil` to **npm** and to **ClawHub** (https://clawhub.com),
and make releasing as smooth as possible — one easy publish command plus a clear
cadence for bumping the version on every change. The klodi OpenClaw adapter is a
loose reference, but it is a monorepo with vendoring/NATS machinery we do not want
here; this repo is a flattened single package, so the release setup must be the
minimal, production-grade equivalent — no staging dir, no vendoring.

Founder-directed: implemented directly in this worktree (not via the agent pipeline),
per the founder's choice. Two-step flow, local scripts (no CI yet).

---

## Signals to orchestrator (append-only)

- 2026-06-11 founder-direct (in-dev) — pattern: this repo carries TWO version fields
  (package.json#version + openclaw.plugin.json#version). klodi keeps them in sync
  manually (latent drift). We close it with a sync-version script + a version-parity
  integration test. Any sibling OpenClaw plugin should adopt the same guard.
- 2026-06-11 founder-direct (in-dev) — sc-candidate: `tsc` does not prune orphaned
  outputs; `dist/tools/examples.js` (deleted skeleton tool) was still shipping in
  `npm pack`. Build now cleans `dist/` first so the tarball matches source exactly.

---

## Discovery findings — founder-direct

### Approach + alternatives ruled out

- **Single source of truth = `package.json#version`, mirrored into the manifest by
  `scripts/sync-version.mjs`.** Ruled out: klodi's manual manifest-version edit
  (drifts); a codegen'd manifest (overkill — one field).
- **Two-step release: `pnpm version <bump>` (bump → sync → test → commit → tag →
  push) then `pnpm release` (build → pack once → publish npm + ClawHub).** Ruled
  out: one-shot `release <bump>` (a mid-flight ClawHub failure leaves a half-released
  state — npm published + tag pushed but ClawHub not; messy recovery). Lean on the
  native npm `preversion`/`version`/`postversion` lifecycle rather than hand-rolled
  git in a script.
- **Pack once, publish the same tarball to both registries.** `npm pack` builds via
  `prepack`; `npm publish <tarball>` and `clawhub package publish <tarball>` upload
  the identical bytes — no drift between what npm and ClawHub serve, one build.
- **Local scripts now, no CI.** ClawHub OIDC/tag-triggered CI is a deferred follow-up.

### Affected files / surfaces

- `scripts/sync-version.mjs` (new) — mirror version into the manifest, in-place edit.
- `scripts/release.mjs` (new) — preflight + pack-once + publish to npm & ClawHub, `--dry-run`.
- `package.json` — fix stale skeleton `description`; add `repository`, `publishConfig`,
  `openclaw.install` / `hostTargets` / `environment` (ClawHub readiness); clean-build;
  `sync-version` + `preversion`/`version`/`postversion` + `prepack` + `release`/`release:dry`.
- `src/__tests__/package-manifest.integration.test.ts` — add version-parity guard.
- `README.md`, `CLAUDE.md` — a `Releasing` section (the two-step cadence + prereqs).
- `docs/decisions/` — capture the release model's non-obvious "why".

### Risks / failure modes

- **Orphaned `dist/` outputs ship as dead code.** Mitigated: `build` cleans `dist/` first.
- **Two version fields drift.** Mitigated: `sync-version` + version-parity integration test.
- **Bare `npm publish` skips the build** (dist is gitignored). Mitigated: `prepack` backstop.
- **Publishing dirty / untagged state.** Mitigated: `release.mjs` preflight (clean tree,
  HEAD carries `v<version>`, `npm whoami`, `clawhub` on PATH) for real publishes.
- **`@4gpts` scope is private-by-default on npm.** Mitigated: `publishConfig.access = public`.

### Acceptance criteria

- `[integration] Given package.json and openclaw.plugin.json are parsed, when their
  versions are compared, then they are equal (single source of truth never drifts).`
- `[integration] Given package.json#version, when checked, then it is plain semver.`
- Manual gates (verified at implementation, not unit-tested — they touch git/npm/clawhub):
  `pnpm build` leaves no orphaned `dist/tools/examples.js`; `pnpm release:dry` runs the
  full build → pack → npm-dry → clawhub-dry pipeline and uploads nothing.

### → Handoff to Review (next agent: code-quality-guardian)

Watch: `release.mjs` preflight must fail-closed (no publish on dirty/untagged/logged-out);
`sync-version` must edit only the manifest version string (minimal diff) and re-verify by
re-parse; no hardcoded secrets; ClawHub owner overridable via `CLAWHUB_OWNER`.

## In Dev — founder-direct

Implementation notes land here as commits on `card/publish-to-npm-clawhub`.
