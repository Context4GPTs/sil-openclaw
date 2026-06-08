# CLAUDE.md — sil-openclaw

Internal contributor-facing instructions for the `sil-openclaw` plugin.

## What this repo is, in one line

`sil-openclaw` is a standalone OpenClaw plugin (TypeScript, Node 22+, ESM). The plugin lives at the **repo root** — there is no `adapters/` nesting. It is a skeleton: it registers stub tools that return placeholder responses, and exists to be copied when adding real tools. Its structure mirrors the klodi OpenClaw adapter, flattened to one repo and stripped of marketplace machinery (no NATS transport, no persistent service, no vendoring).

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

`pnpm build` runs `tsc -p tsconfig.build.json`, emitting `dist/index.js` (the manifest's `main` / `openclaw.extensions` entry). Tests live in `src/__tests__/**` and run on the unit + integration tiers; there is no host-load (e2e) gate in this repo yet — a dockerized publish-shape smoke is a deferred follow-up.

## How to add a tool

The stub tools in `src/tools/examples.ts` (`sil_ping`, `sil_echo`) are the canonical pattern. To add a real tool, do all three steps — the third is the one that silently breaks the plugin if skipped:

1. **Register the tool in a group.** Add an `api.registerTool({ name, label, description, parameters: Type.Object({...}), async execute(callId, params) {...} })` call inside a `registerXTools(api)` function in `src/tools/` (reuse `registerExampleTools`, or add a new group). Return a `ToolResult` — `jsonResult(<data>)` for real payloads, `stubResult(name, params)` for a placeholder.
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

The auto-loaded rules [`.claude/rules/critical-thinking.md`](./.claude/rules/critical-thinking.md) and [`.claude/rules/production-grade-first.md`](./.claude/rules/production-grade-first.md) are non-negotiable — the latter makes production-grade tooling, performance, and code the overriding priority, and we never do backwards-compatibility. Beyond that: strict TypeScript (no `any` at boundaries), no bloat, no hardcoded values that belong in config, fail fast with structured errors, test behavior (mock the host SDK boundary, not logic). The `code-quality-guardian` skill enforces this with a PASS / REVIEW / FAIL verdict before any PR is opened.
