# `knowledge/`

Repo invariants, gotchas, non-obvious behavior — facts that aren't derivable from reading the code or git log.

Sorted by `updated_at` descending (newest first). One row per doc in this folder. The `distillation` skill maintains the table.

| ID | Title | Tags | Updated |
|---|---|---|---|
| [[sil-api-catalog-contract]] | sil-api catalog reads — bare POST /catalog/{search,lookup}, @sil/schemas is wire truth (not @ucp-js/sdk), wrong-boilerplate hazard | sil-api, catalog, search, lookup, contract, wire-types, cross-sibling, gotcha | 2026-06-09 |
| [[sil-response-classification]] | Classify sil responses on body shape, not HTTP status (incl. catalog empty-vs-garbage 200) | sil-api, sil-web, http, classification, false-green | 2026-06-09 |
| [[typecheck-is-the-only-test-type-gate]] | pnpm typecheck is the only gate that type-checks tests (build excludes them, test strips types) | tooling, typescript, vitest, tsconfig, gotcha, false-green, ci-gate | 2026-06-08 |
| [[sil-api-identity-contract]] | sil-api identity read — GET /identity contract, request gotchas, deferred e2e | sil-api, identity, jwt, cross-sibling, e2e | 2026-06-08 |

See [`../README.md`](../README.md) for the docs convention.
