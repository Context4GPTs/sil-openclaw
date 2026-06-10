# `decisions/`

Cross-cutting choices that constrain future work — architecture, dependencies, contracts, naming.

Sorted by `updated_at` descending (newest first). One row per doc in this folder. The `distillation` skill maintains the table.

| ID | Title | Tags | Updated |
|---|---|---|---|
| [[sil-uniform-401-refresh-retry]] | One shared 401 refresh-and-retry-once helper — every sil-api tool routes its 401 through it, never a per-tool handler | architecture, auth, contracts, reuse, refresh, anti-divergence | 2026-06-10 |
| [[sil-shared-catalog-client]] | One shared catalog client + locally-redeclared read-subset types (no @sil/schemas / @ucp-js/sdk dep) | architecture, contracts, dependencies, catalog, reuse | 2026-06-10 |
| [[sil-two-origin-model]] | Two sil origins: sil-web auth authority + sil-api domain reads (now incl. catalog) | architecture, config, auth, contracts | 2026-06-10 |

See [`../README.md`](../README.md) for the docs convention.
