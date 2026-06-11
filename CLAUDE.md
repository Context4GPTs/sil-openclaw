# CLAUDE.md — sil-openclaw

Internal contributor-facing instructions for the `sil-openclaw` plugin.

## What this repo is, in one line

`sil-openclaw` is a standalone OpenClaw plugin (TypeScript, Node 22+, ESM) that exposes sil's UCP commerce tools to an agent — identity (`sil_register`, `sil_whoami`) and catalog (`sil_search`, `sil_product_get`). The plugin lives at the **repo root** — there is no `adapters/` nesting. Its structure mirrors the klodi OpenClaw adapter, flattened to one repo and stripped of marketplace machinery (no NATS transport, no persistent service, no vendoring).

**UCP reference.** This plugin implements UCP commerce tools. The spec and SDKs
live at `../../vendor/ucp/` (see parent `CLAUDE.md` for the full map). Before
implementing or modifying any tool that touches commerce wire formats, read the
relevant spec doc in `../../vendor/ucp/spec/docs/specification/`. For TypeScript
types, check `../../vendor/ucp/js-sdk/src/` (`@ucp-js/sdk`, Zod-generated).

## Build & test

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Build (`tsc` → `dist/`) | `pnpm build` |
| Type-check only | `pnpm typecheck` |
| Test (vitest) | `pnpm test` |
| Watch build | `pnpm dev` |

`pnpm build` runs `pnpm clean && tsc -p tsconfig.build.json` — it wipes `dist/` first (so an output orphaned by a deleted source never lingers in the published tarball), then emits `dist/index.js` (the manifest's `main` / `openclaw.extensions` entry). Tests live in `src/__tests__/**` and run on the unit + integration tiers; there is no host-load (e2e) gate in this repo yet — a dockerized publish-shape smoke is a deferred follow-up.

## Releasing

`sil-openclaw` ships to **npm** (as `sil-openclaw`) and **ClawHub** (as `@4gpts/sil`, under the `4gpts` org) in two steps — bump on every change, publish when ready. `package.json#version` is the single source of truth; `scripts/sync-version.mjs` mirrors it into `openclaw.plugin.json#version` (a version-parity test in `package-manifest.integration.test.ts` fails on drift).

| Step | Command | What it does |
|---|---|---|
| Bump (the cadence) | `pnpm version patch\|minor\|major` | `preversion` runs typecheck + tests → bumps `package.json` → `version` syncs the manifest + stages it → commits + tags `v<x.y.z>` → `postversion` pushes commit + tag |
| Preview | `pnpm release:dry` | clean build → pack one tarball → `npm publish --dry-run` + `clawhub … --dry-run`; uploads nothing |
| Publish | `pnpm release` | same pipeline, real upload — identical contents to npm (`sil-openclaw`) and ClawHub (`@4gpts/sil`, re-packed under that name) — `code-plugin` family, `--owner $CLAWHUB_OWNER` defaulting to the `4gpts` org, with source-repo/commit attribution |

`scripts/release.mjs` builds once, packs the npm tarball, then re-packs the identical contents under the ClawHub name `@4gpts/sil` (the bare id `sil` is unclaimable — already owned by that package) and uploads to both (no cross-registry content drift). For a real publish it fails closed unless the tree is clean, HEAD carries the `v<version>` tag, `npm whoami` succeeds, and `clawhub` is on PATH — so the flow is always `pnpm version …` then `pnpm release`. Keep `CHANGELOG.md`'s `## [Unreleased]` current as you work — the `version` lifecycle cuts it to a dated section (`scripts/changelog.mjs`) and `release.mjs` passes those notes to `clawhub … --changelog`; after a real publish, `clawhub package readiness @4gpts/sil` reports readiness blockers. First-time setup: `npm login`, then `npm i -g clawhub && clawhub login`. CI (tag-triggered OIDC trusted publishing + npm provenance) is a deferred follow-up — local scripts only for now.

## How to add a tool

The real tool groups in `src/tools/` are the canonical pattern: `identity.ts` (`sil_register`, `sil_whoami`) is the reference — it sets the `jsonResult` success shape and the structured-error/recovery envelope every tool follows — and `catalog.ts` (`sil_search`, `sil_product_get`) is the catalog counterpart. To add a real tool, do all three steps — the third is the one that silently breaks the plugin if skipped:

1. **Register the tool in a group.** Add an `api.registerTool({ name, label, description, parameters: Type.Object({...}), async execute(callId, params) {...} })` call inside a `registerXTools(api)` function in `src/tools/` (extend `registerIdentityTools` / `registerCatalogTools`, or add a new group). Return a `ToolResult` via `jsonResult(<data>)`.
2. **Wire the group into `register()`.** If you added a new `registerXTools` group, call it from `register(api)` in `src/index.ts`. (Adding a tool to an existing group needs no change here.)
3. **Add the tool's name to `contracts.tools`.** List the new `name` in `openclaw.plugin.json#contracts.tools`.

Step 3 is load-bearing: the `manifest-contract.integration.test.ts` drift guard set-compares `openclaw.plugin.json#contracts.tools` against the names `register()` actually registers and FAILS if they disagree — in either direction. That test is what makes this pattern self-enforcing, so a forgotten manifest entry (or a stale one) is caught before merge, not in production.

`register()` must stay **synchronous** and open nothing — no sockets, no timers, no unawaited promises. A long-lived resource opened at register time holds the host's install subprocess event loop open and blocks gateway startup. Do real work inside a tool's `execute`, never in `register()`.

## Docs taxonomy

Knowledge is captured as small, individually-addressable docs under `docs/`, each with frontmatter, organized by area (the `distillation` skill owns the workflow — search the area's `INDEX.md` first, prefer editing an existing doc over creating a new one):

| Folder | What lives here |
|---|---|
| `docs/decisions/` | Cross-cutting choices that constrain future work (architecture, dependencies, contracts, naming). |
| `docs/knowledge/` | Repo invariants, gotchas, non-obvious behavior not derivable from the code. |
| `docs/product/` | Product spec: flows, business rules, UX principles, glossary. |

See [`docs/README.md`](./docs/README.md) for the full convention.

## Standards

The auto-loaded rules [`.claude/rules/critical-thinking.md`](./.claude/rules/critical-thinking.md), [`.claude/rules/production-grade-first.md`](./.claude/rules/production-grade-first.md), and [`.claude/rules/complete-work-is-stub-free.md`](./.claude/rules/complete-work-is-stub-free.md) are non-negotiable — the second makes production-grade tooling, performance, and code the overriding priority, and we never do backwards-compatibility; the third makes completed work stub-free (stubs are replaced on touch, never tested or maintained). Beyond that: strict TypeScript (no `any` at boundaries), no bloat, no hardcoded values that belong in config, fail fast with structured errors, test behavior (mock the host SDK boundary, not logic). The `code-quality-guardian` skill enforces this with a PASS / REVIEW / FAIL verdict before any PR is opened.
