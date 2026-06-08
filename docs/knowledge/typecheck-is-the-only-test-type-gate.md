---
id: typecheck-is-the-only-test-type-gate
title: pnpm typecheck is the only gate that type-checks tests (build excludes them, test strips types)
tags: [tooling, typescript, vitest, tsconfig, gotcha, false-green, ci-gate]
card: migrate-openclaw-tool-schemas-to-typebox-1-x
commit: 7e9d951
updated_at: 2026-06-08
updated_by_card: migrate-openclaw-tool-schemas-to-typebox-1-x
---

A **type error that lives only in a test file passes `pnpm build` AND `pnpm test`, and is caught solely by `pnpm typecheck`.** Any green gate for a change that touches `src/__tests__/**` must therefore run `pnpm typecheck` — `build && test` alone is a false-green for test type-correctness.

This is not visible from any single file; it emerges from how the three scripts are wired (`package.json`):

| Script | Command | Type-checks `src/__tests__`? | Why |
|---|---|---|---|
| `pnpm build` | `tsc -p tsconfig.build.json` | **No** | `tsconfig.build.json` sets `"exclude": [..., "src/__tests__"]` — the build deliberately compiles only shippable sources into `dist/`. |
| `pnpm test` | `vitest run` | **No** | vitest (esbuild under the hood) **strips** types without checking them — it runs the JS, it does not `tsc` the tests. |
| `pnpm typecheck` | `tsc --noEmit` | **Yes** | Uses `tsconfig.json` (`"include": ["src"]`, which covers `src/__tests__`) — the only one of the three that reads the tests through the type-checker. |

## Why it matters (the failure it prevents)

A change can be functionally correct and fully green on `build` + `test` while carrying a test that does not type-check. If a gate omits `typecheck`, that error ships and only surfaces the next time someone runs `typecheck` locally — detached from the change that introduced it.

The migrate-openclaw-tool-schemas-to-typebox-1-x card hit this exactly: TypeBox 1.x tightened a type such that three casts in `tool-schema-contract.unit.test.ts` stopped compiling (TS2352), yet `pnpm build` and `pnpm test` both stayed green — only `pnpm typecheck` went red. The migration's own acceptance criteria listed all three gates for this reason. (The specific cast fix is captured inline at the cast sites; the point *here* is the gate topology, which recurs for any test-only type error regardless of cause.)

## The rule for future cards

- The green gate for any card touching test files is **`pnpm typecheck && pnpm build && pnpm test`**, all three — in any order, but `typecheck` is non-negotiable.
- Do **not** assume `pnpm test` covers type-correctness. It runs behavior; it is blind to types.
- Do **not** assume `pnpm build` covers the tests. It excludes them by design (tests are not shipped).
