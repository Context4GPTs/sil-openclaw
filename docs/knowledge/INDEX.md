# `knowledge/`

Repo invariants, gotchas, non-obvious behavior — facts that aren't derivable from reading the code or git log.

Sorted by `updated_at` descending (newest first). One row per doc in this folder. The `distillation` skill maintains the table.

| ID | Title | Tags | Updated |
|---|---|---|---|
| [[sil-api-catalog-contract]] | sil-api catalog reads — FLAT `{ ucp, products, … }` envelope (no `result` wrapper), bare POST /catalog/{search,lookup}, OPEN `SearchFilters` (serviceability filters fail GREEN on a wrong key), `ships_to`/`ships_from` FORMAT regexes mirror `@sil/schemas` byte-for-byte (no shared pkg; reject-client-side), @sil/schemas is wire truth (not @ucp-js/sdk) | sil-api, catalog, search, lookup, contract, wire-types, envelope, filters, serviceability, ship-to, format, cross-sibling, gotcha | 2026-06-11 |
| [[sil-response-classification]] | Classify sil responses on body shape, not HTTP status — anti-false-green guard is `Array.isArray(products)`, NOT a `result` wrapper (search/lookup read flat, identity dual-reads) | sil-api, sil-web, http, classification, false-green, envelope | 2026-06-10 |
| [[sil-api-identity-contract]] | sil-api identity read — GET /identity returns a FLAT `{ ucp, id, name, addresses }` envelope (extractIdentity dual-reads `result ?? envelope`), request gotchas, deferred e2e | sil-api, identity, jwt, envelope, cross-sibling, e2e | 2026-06-10 |
| [[typecheck-is-the-only-test-type-gate]] | pnpm typecheck is the only gate that type-checks tests (build excludes them, test strips types) | tooling, typescript, vitest, tsconfig, gotcha, false-green, ci-gate | 2026-06-08 |

See [`../README.md`](../README.md) for the docs convention.
