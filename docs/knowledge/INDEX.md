# `knowledge/`

Repo invariants, gotchas, non-obvious behavior — facts that aren't derivable from reading the code or git log.

Sorted by `updated_at` descending (newest first). One row per doc in this folder. The `distillation` skill maintains the table.

| ID | Title | Tags | Updated |
|---|---|---|---|
| [[skeleton-stubs-are-compliant-until-touched]] | The sil_ping/sil_echo skeleton stubs are NOT a stub-free violation — de-stubbing is gated on touch | stub, skeleton, complete-work-is-stub-free, examples, copy-me, gotcha, review | 2026-06-08 |
| [[typecheck-is-the-only-test-type-gate]] | pnpm typecheck is the only gate that type-checks tests (build excludes them, test strips types) | tooling, typescript, vitest, tsconfig, gotcha, false-green, ci-gate | 2026-06-08 |
| [[sil-api-identity-contract]] | sil-api identity read — GET /identity contract, request gotchas, deferred e2e | sil-api, identity, jwt, cross-sibling, e2e | 2026-06-08 |
| [[sil-response-classification]] | Classify sil responses on body shape, not HTTP status | sil-api, sil-web, http, classification, false-green | 2026-06-08 |

See [`../README.md`](../README.md) for the docs convention.
